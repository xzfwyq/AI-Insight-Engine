// @ts-check
/**
 * Reduce 阶段 - 跨条聚合 + AI 总结
 *
 * 核心设计(响应题目"不允许一次性丢原始数据给 AI"):
 * 1. 代码统计:实体频次/主题分布/情感均值/时间聚类 —— 完全基于 Map 产出的结构化 Event
 * 2. AI 总结:只喂结构化 Event 数组(不喂原始新闻文本),用 Tool Use 强制 Schema
 * 3. 这样既做了跨条分析,又不违反规则,且可复现
 */

import Anthropic from '@anthropic-ai/sdk';

import { AiSummarySchema } from '../schema/event.js';
import { AGGREGATE_TOOL_SCHEMA } from '../schema/event-tool-schema.js';
import { computeLexiconSentiment } from '../sentiment/lexicon.js';

let _client = null;
let _model = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  return _client;
}

function getModel() {
  if (!_model) {
    _model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    console.log(`  [aggregator] 使用模型: ${_model}`);
  }
  return _model;
}

/**
 * 标准主题词表(15 个 canonical 主题 + 同义词关键词)
 *
 * 设计动机:Map 阶段每条事件独立抽取,AI 自由生成主题词,导致 78 个主题里 72 个频次为 1
 * (如 "LLM"/"llm"/"大模型" 各算一个)。Reduce 阶段做跨条归一化,收敛到 15 个标准主题,
 * 让图谱/分布可读。这是 Map-Reduce 架构的结构性价值 — 一次性丢给 AI 做不到归一化。
 *
 * 匹配规则:子串包含(忽略大小写),顺序敏感(特殊/长的词放前面,避免"开源"误吞"开源框架")
 * 映射不上的归到 "其他"
 */
const TOPIC_TAXONOMY = [
  { canonical: '开源框架', keywords: ['开源框架', 'open-source framework', 'framework', '框架'] },
  { canonical: '开源模型', keywords: ['开源模型', 'open-source model', '开源生态', 'open source', '开源', 'pretrained'] },
  { canonical: '本地推理', keywords: ['本地推理', 'local inference', 'llama.cpp', 'ollama', '本地部署', 'edge ai', '实时推理', 'real-time'] },
  { canonical: '记忆机制', keywords: ['memory', '记忆', 'long-horizon', '长程', 'long context', 'rag', '检索增强'] },
  { canonical: '评测基准', keywords: ['benchmark', '评测', 'terminal-bench', 'tau-bench', '基准'] },
  { canonical: '训练方法', keywords: ['training', 'fine-tune', 'fine tune', 'sft', 'grpo', 'rlhf', 'reinforcement learning', '强化学习', '微调', '训练', 'nlp', 'natural language', 'contrastive', 'language modeling', 'stance'] },
  { canonical: '推理优化', keywords: ['reasoning', '推理优化', 'inference', 'efficiency', '效率', 'attention', 'transformer architecture', '稀疏'] },
  { canonical: '具身智能', keywords: ['具身', 'embodied', '机器人', '数据采集', '遥操'] },
  { canonical: '多模态', keywords: ['multimodal', 'multi-modal', 'vision', '多模态', '视觉', '语音', 'audio', '视频', 'video', 'sam', 'tracking', '分割'] },
  { canonical: '编程能力', keywords: ['coding', '编程', '代码生成', 'code generation', 'code', 'prompt', 'loop engineering', 'developer', '开发者工具'] },
  { canonical: 'Agent', keywords: ['agent', '智能体', 'autonomous', 'multi-agent', '自治', '自主', '自我进化', '多代理'] },
  { canonical: 'LLM', keywords: ['llm', 'large language model', '大模型', '基础模型', 'foundation model', 'machine learning', 'claude', 'ai'] },
  { canonical: '知识产权', keywords: ['知识产权', '诉讼', '专利', '版权', '商业机密', 'trade secret', '竞业'] },
  { canonical: '政策监管', keywords: ['监管', '合规', '隐私', '政策', '伦理', '安全', 'safety'] },
  { canonical: '商业化', keywords: ['商业化', '产品发布', '营收', 'maas', '市值', '上市', '融资', '投资', '创业', 'market', '成本优化', 'cost'] },
];

function normalizeTopicName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '其他';
  const lower = rawName.toLowerCase().trim();
  for (const { canonical, keywords } of TOPIC_TAXONOMY) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return canonical;
    }
  }
  return '其他';
}

/**
 * 归一化单个事件的 topics:保留原始名称到 originalName,name 用标准主题
 */
function normalizeEventTopics(ev) {
  const topics = (ev.topics || []).map((t) => ({
    name: normalizeTopicName(t.name),
    originalName: t.name,
    confidence: t.confidence,
  }));
  // 同一事件内可能多个原始主题归到同一 canonical,去重(保留 confidence 最高的)
  const dedup = new Map();
  for (const t of topics) {
    if (!dedup.has(t.name) || (t.confidence || 0) > (dedup.get(t.name).confidence || 0)) {
      dedup.set(t.name, t);
    }
  }
  return { ...ev, topics: Array.from(dedup.values()) };
}

/**
 * 词典情感分析(替代 AI 自由判断)
 *
 * 用 title + summary 作为输入,词典打分覆盖 AI 的 sentiment
 * 保留原 AI 结果到 originalSentiment,输出 method/posHits/negHits 做可解释性
 *
 * 为什么用词典而非 AI:
 * - AI 把"全网骂 Claude 变笨"判中性(把"揭秘"框架当中性,没识别"骂/变笨")
 * - 词典法可复现/可审计(追溯到具体词)/可测试(单测覆盖)/不依赖 AI
 * - 详见 src/sentiment/lexicon.js
 */
function applyLexiconSentiment(ev) {
  const text = [ev.title, ev.summary].filter(Boolean).join(' ');
  const lex = computeLexiconSentiment(text);
  return {
    ...ev,
    originalSentiment: ev.sentiment,
    sentiment: {
      direction: lex.direction,
      score: lex.score,
      method: 'lexicon',
      posHits: lex.posHits.map((h) => h.word),
      negHits: lex.negHits.map((h) => h.word),
    },
  };
}

/**
 * 代码统计:实体频次
 */
function topEntities(events, limit = 15) {
  const counter = new Map();
  for (const ev of events) {
    for (const e of ev.entities || []) {
      const key = `${e.name}::${e.type}`;
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  }
  return Array.from(counter.entries())
    .map(([key, count]) => {
      const [name, type] = key.split('::');
      return { name, type, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * 代码统计:主题分布(输入需为归一化后的 events)
 */
function topicDistribution(events) {
  const counter = new Map();
  for (const ev of events) {
    for (const t of ev.topics || []) {
      const name = t.name; // 已归一化,不再 lower-case(否则中英文混合时 "LLM" 和 "llm" 还是会分叉)
      counter.set(name, (counter.get(name) || 0) + 1);
    }
  }
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 代码统计:情感概览
 */
function sentimentOverview(events) {
  const stats = { positive: 0, negative: 0, neutral: 0, totalScore: 0 };
  for (const ev of events) {
    if (!ev.sentiment) continue;
    stats[ev.sentiment.direction]++;
    stats.totalScore += ev.sentiment.score || 0;
  }
  return {
    positive: stats.positive,
    negative: stats.negative,
    neutral: stats.neutral,
    avgScore: events.length ? stats.totalScore / events.length : 0,
  };
}

/**
 * 代码统计:语言分布
 */
function languageDistribution(events) {
  const dist = { zh: 0, en: 0 };
  for (const ev of events) {
    dist[ev.language]++;
  }
  return dist;
}

/**
 * 计算传播热度分(0-100)
 * 基于数据源特有指标归一化加权:
 * - GitHub: stars(对数缩放,100k stars = 满分)
 * - Dev.to: reactionsCount(线性,50 reactions = 满分)
 * - 知乎: heat 数值化(提取"X 万热度",100 万 = 满分)
 * - HN: 无 score 时用 significance 兜底
 * - 其他源: 用 significance * 60 兜底
 */
function computeHeatScore(ev) {
  const m = ev.source?.metadata || {};
  const sig = ev.impact?.scope ? 0.5 : 0.3;

  switch (ev.source?.type) {
    case 'github': {
      const stars = m.stars || 0;
      // 对数缩放:log10(stars) / log10(100000) * 100
      return Math.min(100, Math.round((Math.log10(Math.max(1, stars)) / 5) * 100));
    }
    case 'devto': {
      const reactions = m.reactionsCount || 0;
      return Math.min(100, Math.round((reactions / 50) * 100));
    }
    case 'zhihu': {
      const heatStr = m.heat || '';
      const heatNum = parseFloat(heatStr);
      if (!isNaN(heatNum)) {
        return Math.min(100, Math.round((heatNum / 100) * 100));
      }
      return Math.round(sig * 100);
    }
    case 'hn': {
      // HN score 没抽出来,用 commentsCount 兜底
      const comments = m.commentsCount || 0;
      return Math.min(100, Math.round((comments / 100) * 100) + 20);
    }
    default: {
      // techcrunch/36kr/hf_papers:用 significance 兜底(0-1 映射到 0-60)
      return Math.round((ev._significance || sig) * 60);
    }
  }
}

/**
 * 为所有事件添加 heatScore 字段
 */
function enrichWithHeat(events, topEventMap) {
  return events.map((ev) => {
    const significance = topEventMap.get(ev.id) || 0;
    return {
      ...ev,
      _significance: significance,
      heatScore: computeHeatScore({ ...ev, _significance: significance }),
    };
  });
}

/**
 * 提取风险预警事件
 * 规则:负面情感 OR impact.scope=industry OR significance>=0.7
 */
function extractRiskAlerts(events, topEventMap) {
  return events
    .map((ev) => {
      const significance = topEventMap.get(ev.id) || 0;
      const isNegative = ev.sentiment?.direction === 'negative';
      const isIndustryImpact = ev.impact?.scope === 'industry';
      const isHighSignificance = significance >= 0.7;
      const riskLevel = isNegative && isIndustryImpact ? 'high' :
                       (isNegative || isIndustryImpact) && isHighSignificance ? 'medium' :
                       isHighSignificance ? 'low' : null;
      if (!riskLevel) return null;
      return {
        id: ev.id,
        title: ev.title,
        summary: ev.summary,
        riskLevel,
        reason: isNegative ? '负面舆情' : isIndustryImpact ? '行业级影响' : '高重要性',
        sentiment: ev.sentiment,
        impact: ev.impact,
        significance,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.riskLevel] - order[b.riskLevel];
    });
}

const AGGREGATE_TOOL = {
  name: 'aggregate_report',
  description: '返回日报聚合分析结果。topEvents 的 id 必须从输入数据中复制,trendAnalysis 和 riskOpportunity 必须引用具体事件作为论据。',
  input_schema: AGGREGATE_TOOL_SCHEMA,
};

const SYSTEM_PROMPT = `# 角色
你是 AI 行业资深分析师兼舆情研判专家,具备 10 年以上 AI/科技产业研究经验,擅长从碎片化资讯中提炼趋势、识别风险与机会,输出结构化、可决策的日报分析。

# 项目背景
本系统用于从每日新闻信息中提取结构化洞察,生成可读的分析报告与可视化结果,服务于三大应用场景:
1. **AI 行业趋势分析** — 技术演进、应用落地、竞争格局、资本流向
2. **舆情监测与风险预警** — 负面事件识别、知识产权/合规/声誉风险预警
3. **信息快速理解与决策辅助** — 帮助用户在 30 秒内抓住当日要点,辅助投资/研发/战略决策

# 用户画像
- AI 从业者(开发者/研究员/产品经理):关注技术趋势与工具链变化
- 投资人/分析师:关注资本动向、估值、IPO、并购
- 企业决策者:关注竞争格局、政策风险、机会窗口

# 输出规范(对标 TLDR AI / 36氪早报 / CB Insights,扫读优先)

## headline(一句话总结,20-40 字)
- 必须具体,不要空洞的开场白
- ✅ 好:"AI 开发范式从 Prompt 迁移到自主 Loop,Anthropic 80% 工程师已转向"
- ❌ 差:"今日事件呈现多维度演进"

## keyPoints(3 个核心要点,每个 30-50 字)
- 每条一句话,必须引用具体事件作为论据
- eventId 必须从输入数据复制,用于前端点击跳转
- 覆盖不同维度(技术/应用/竞争/资本),不要全挤在一个维度

## trends(按维度分栏,bullet 形式)
- 维度:技术 / 应用 / 竞争 / 资本 / 政策(只输出有内容的维度)
- 每栏 2-3 条 bullet,每条一句话引用"事件N"
- ❌ 不要写大段文字(用户扫读,不细读)

## risks(1-3 条风险,每条 {title + description + eventId})
- title: 10-20 字,动作导向(如"IP 合规风险上升")
- description: 30-60 字,说明风险 + 谁受影响 + 怎么应对
- 聚焦:负面舆情、知识产权、合规监管、声誉危机、供应链断裂

## opportunities(1-3 条机会,每条 {title + description + eventId})
- title: 10-20 字,机会导向(如"Loop Engineering 工具链蓝海")
- description: 30-60 字,说明机会 + 谁能受益 + 时间窗口
- 聚焦:新赛道、技术突破、政策利好、并购整合、开源生态

## topEvents(3-5 个最重要事件)
- 按 significance 0-1 排序,id 从输入数据复制
- reason: 一句话说明为什么重要,引用具体数据

# 核心原则
1. **每个论点必须引用具体事件**(用"事件N"指代),不要空洞描述
2. **bullet 形式,不要大段文字** — 用户只扫读 20% 内容(尼尔森诺曼集团研究)
3. **risks 和 opportunities 分开** — 风险=规避,机会=抓取,决策动作不同
4. **具体优于抽象** — "Anthropic 80% 工程师转向 Loop" 优于 "行业范式正在迁移"
5. **不发挥不推测** — 只基于输入数据,不添加外部知识

必须调用 aggregate_report 工具返回结果。`;

/**
 * AI 总结:热点 Top5 + 趋势 + 风险
 * 只喂结构化 Event 数组,不喂原始新闻
 * 用 Tool Use 强制 Schema + Zod 校验 + 失败重试
 */
async function aiSummarize(events) {
  console.log('  [aggregator] 调用 AI 生成趋势分析(Tool Use)...');

  const compactEvents = events.map((ev, i) => ({
    id: ev.id,
    eventIndex: i + 1,
    title: ev.title,
    summary: ev.summary,
    language: ev.language,
    source: ev.source.type,
    publishedAt: ev.publishedAt,
    entities: ev.entities.map((e) => ({ name: e.name, type: e.type })),
    topics: ev.topics.map((t) => t.name),
    sentiment: ev.sentiment,
    impact: ev.impact,
  }));

  const userMessage = `以下是从多个数据源结构化抽取的 ${events.length} 条 AI 相关事件(已过 Map 阶段,非原始新闻)。

请基于这些结构化数据,生成日报分析:
- headline: 一句话总结今日核心趋势
- keyPoints: 3 个要点(每个引用具体 eventId)
- trends: 按维度分栏(技术/应用/竞争/资本/政策),bullet 形式
- risks: 1-3 条风险
- opportunities: 1-3 条机会
- topEvents: 3-5 个最重要事件

结构化数据(JSON,事件编号用于引用):
${JSON.stringify(compactEvents, null, 2)}

请调用 aggregate_report 工具返回结果。所有 eventId 必须从上面数据中复制。`;

  const MAX_RETRIES = 2;
  const messages = [{ role: 'user', content: userMessage }];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await getClient().messages.create({
      model: getModel(),
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [AGGREGATE_TOOL],
      tool_choice: { type: 'tool', name: 'aggregate_report' },
      messages,
    });

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolUseBlock) {
      console.log(`  [aggregator] ⚠️ 响应无 tool_use block(attempt ${attempt + 1})`);
      if (attempt < MAX_RETRIES) continue;
      throw new Error('AI 总结多次未调用工具');
    }

    console.log(`  [aggregator] attempt ${attempt + 1}: stop_reason=${response.stop_reason}`);

    // Zod 运行时校验(只校验 AI 负责的字段:topEvents/trendAnalysis/riskOpportunity)
    const result = AiSummarySchema.safeParse(toolUseBlock.input);
    if (result.success) {
      console.log(`  [aggregator] ✅ 解析成功,选出 ${result.data.topEvents?.length || 0} 个热点`);
      return result.data;
    }

    const errorMsg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    console.log(`  [aggregator] ⚠️ 校验失败(attempt ${attempt + 1}): ${errorMsg.slice(0, 100)}`);

    if (attempt < MAX_RETRIES) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            is_error: true,
            content: `Schema 校验失败: ${errorMsg}。请修正后重新调用 aggregate_report。`,
          },
        ],
      });
    } else {
      // 降级:即使 Zod 校验失败,只要有 topEvents/trendAnalysis 就用
      if (toolUseBlock.input?.topEvents && toolUseBlock.input?.trendAnalysis) {
        console.log('  [aggregator] ⚠️ Zod 校验失败但核心字段完整,降级使用未校验版本');
        return toolUseBlock.input;
      }
      throw new Error(`AI 总结校验失败: ${errorMsg}`);
    }
  }
  throw new Error('AI 总结失败');
}

/**
 * Reduce 主函数
 */
export async function aggregate(events) {
  console.log('=== Reduce 阶段:跨条聚合 ===');
  console.log(`输入: ${events.length} 个结构化 Event\n`);

  // 步骤1: 主题归一化(Map 阶段 AI 自由生成的主题 → 15 个标准主题)
  const normalizedEvents = events.map(normalizeEventTopics);
  const beforeUnique = new Set(events.flatMap((e) => (e.topics || []).map((t) => t.name.toLowerCase()))).size;
  const afterUnique = new Set(normalizedEvents.flatMap((e) => (e.topics || []).map((t) => t.name))).size;
  console.log(`  主题归一化: ${beforeUnique} 个原始主题 → ${afterUnique} 个标准主题`);

  // 步骤2: 词典情感分析(覆盖 AI 自由判断,可复现可审计)
  const sentimentAdjustedEvents = normalizedEvents.map(applyLexiconSentiment);
  const sentimentChanged = sentimentAdjustedEvents.filter(
    (ev) => ev.originalSentiment?.direction !== ev.sentiment.direction
  ).length;
  console.log(`  词典情感分析: ${sentimentAdjustedEvents.length} 条,${sentimentChanged} 条与 AI 判断不一致\n`);

  const stats = {
    topEntities: topEntities(sentimentAdjustedEvents),
    topicDistribution: topicDistribution(sentimentAdjustedEvents),
    sentimentOverview: sentimentOverview(sentimentAdjustedEvents),
    languageDistribution: languageDistribution(sentimentAdjustedEvents),
  };

  console.log(`  实体频次 Top5: ${stats.topEntities.slice(0, 5).map((e) => `${e.name}(${e.count})`).join(', ')}`);
  console.log(`  主题分布 Top5: ${stats.topicDistribution.slice(0, 5).map((t) => `${t.name}(${t.count})`).join(', ')}`);
  console.log(`  情感(词典): +${stats.sentimentOverview.positive} -${stats.sentimentOverview.negative} =${stats.sentimentOverview.neutral} avg=${stats.sentimentOverview.avgScore.toFixed(2)}`);
  console.log(`  语言: zh=${stats.languageDistribution.zh} en=${stats.languageDistribution.en}\n`);

  // AI 总结也喂归一化+词典情感后的 events
  const aiResult = await aiSummarize(sentimentAdjustedEvents);

  // 构建 topEvent id → significance 映射,用于热度计算和风险预警
  const topEventMap = new Map(
    (aiResult.topEvents || []).map((e) => [e.id, e.significance || 0])
  );

  // 为所有事件添加 heatScore
  const enrichedEvents = enrichWithHeat(sentimentAdjustedEvents, topEventMap);

  // 提取风险预警
  const riskAlerts = extractRiskAlerts(sentimentAdjustedEvents, topEventMap);
  console.log(`  风险预警: ${riskAlerts.length} 条(high=${riskAlerts.filter(r=>r.riskLevel==='high').length}, medium=${riskAlerts.filter(r=>r.riskLevel==='medium').length}, low=${riskAlerts.filter(r=>r.riskLevel==='low').length})`);

  const report = {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    languageDistribution: stats.languageDistribution,
    topEntities: stats.topEntities,
    topicDistribution: stats.topicDistribution,
    sentimentOverview: stats.sentimentOverview,
    topEvents: aiResult.topEvents || [],
    // 新结构化字段(对标 TLDR/36氪早报/CB Insights)
    headline: aiResult.headline || '',
    keyPoints: aiResult.keyPoints || [],
    trends: aiResult.trends || [],
    risks: aiResult.risks || [],
    opportunities: aiResult.opportunities || [],
    // 向后兼容(markdown.js 仍用 trendAnalysis/riskOpportunity)
    trendAnalysis: aiResult.trendAnalysis || aiResult.headline || '',
    riskOpportunity: aiResult.riskOpportunity || '',
    riskAlerts,
    enrichedEvents,
  };

  console.log(`\n=== Reduce 完成 ===\n`);
  return report;
}

export { topEntities, topicDistribution, sentimentOverview, normalizeTopicName, TOPIC_TAXONOMY };
