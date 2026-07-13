// @ts-check
/**
 * Map 阶段 - 逐条 Tool Use 抽取结构化 Event
 *
 * 核心设计(展示"超越常人"的 AI 工程):
 * 1. 用 Anthropic Tool Use + tool_choice 强制模型按 Schema 返回(不是 JSON.parse 自由文本)
 * 2. input_schema 用手写内联 JSON Schema(无 $ref),兼容所有 Anthropic 协议网关
 * 3. Zod 运行时校验:失败时把错误以 tool_result(is_error:true) 喂回模型,最多重试 2 次
 * 4. p-limit 并发 3,避免 rate limit
 *
 * 关键经验(ADR-006):
 * zod-to-json-schema 默认生成带 $ref 的 Schema,GLM 兼容协议网关不支持 $ref,
 * 会导致 tool_use.input 返回空 {}。改用手写内联 Schema 解决。
 * 详见 docs/adr/006-tool-use-inlined-schema.md
 */

import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';

import { EventSchema } from '../schema/event.js';
import { EVENT_TOOL_SCHEMA } from '../schema/event-tool-schema.js';

const MAX_TOKENS = 3000;
const MAX_RETRIES = 2;
const CONCURRENCY = 3;

/**
 * 成本估算(按 Claude Sonnet 4.6 公开价格,单位 USD/1M tokens)
 * 即使走 GLM 网关,也用 Sonnet 价格作为"等价成本"参考
 */
const PRICING = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.3,
  cacheCreation: 3.75,
};

function computeCost(usage) {
  if (!usage) return 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  return (input * PRICING.input + output * PRICING.output +
          cacheRead * PRICING.cacheRead + cacheCreation * PRICING.cacheCreation) / 1_000_000;
}

function aggregateUsage(usages) {
  const total = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const u of usages) {
    if (!u) continue;
    total.input_tokens += u.input_tokens || 0;
    total.output_tokens += u.output_tokens || 0;
    total.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    total.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
  }
  // 缓存命中率 = cache_read / (cache_read + input + cache_creation)
  const denom = total.cache_read_input_tokens + total.input_tokens + total.cache_creation_input_tokens;
  const cacheHitRate = denom > 0 ? total.cache_read_input_tokens / denom : 0;
  // 开缓存的实际成本:input 按原价 + cache_read 按 0.1 倍 + cache_creation 按 1.25 倍 + output 按原价
  const costWithCache = computeCost(total);
  // 不开缓存的理论成本:所有输入(含被缓存的部分)都按 input 原价
  const costNoCache = ((total.input_tokens + total.cache_read_input_tokens + total.cache_creation_input_tokens) * PRICING.input +
                       total.output_tokens * PRICING.output) / 1_000_000;
  return {
    ...total,
    totalTokens: total.input_tokens + total.output_tokens + total.cache_read_input_tokens + total.cache_creation_input_tokens,
    cacheHitRate: Number(cacheHitRate.toFixed(4)),
    costEstimateUSD: Number(costWithCache.toFixed(4)),
    costWithoutCacheUSD: Number(costNoCache.toFixed(4)),
    savingsUSD: Number((costNoCache - costWithCache).toFixed(4)),
    savingsPercent: costNoCache > 0 ? Number(((costNoCache - costWithCache) / costNoCache * 100).toFixed(1)) : 0,
    pricingModel: 'claude-sonnet-4-6-public',
  };
}

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
    console.log(`  [extractor] 使用模型: ${_model}${process.env.ANTHROPIC_BASE_URL ? ` @ ${process.env.ANTHROPIC_BASE_URL}` : ''}`);
  }
  return _model;
}

const EVENT_TOOL = {
  name: 'extract_event',
  description: '从新闻/论文/讨论中抽取结构化事件信息。必须严格按照 schema 填写,不确定的字段用 null 或省略。entities 至少 1 个,topics 至少 1 个。',
  input_schema: EVENT_TOOL_SCHEMA,
};

const SYSTEM_PROMPT = `你是专业的新闻结构化抽取器。任务:从一条新闻/论文/讨论中抽取结构化 Event 信息。

核心规则:
1. 只抽取文本明确陈述的信息,不发挥、不推测
2. 无法从文本中确定的字段,用 null 或省略(可选字段)
3. entities 至少抽取 1 个,尽量覆盖文中提到的关键实体(公司/产品/技术/人物/论文/仓库等)
4. topics 至少 1 个,反映事件主题(如 "LLM"、"多模态"、"Agent"、"开源模型" 等)
5. sentiment 基于文本整体情感倾向
6. impact 字段:只在文本有明确影响信息时填写,否则省略
7. summary 用中文(无论原文语言),严格控制在 150-250 字之间(超过 300 字会被 schema 拒绝),客观陈述,不堆砌细节
8. entities/topics 的 name 用原文出现的名称(英文实体保留英文)

数据源类型提示(辅助判断实体类型):
- hf_papers:学术论文,实体多为 paper/method/dataset
- hn:技术社区讨论,实体多为 technology/product
- devto:开发者文章,实体多为 framework/repository/technology
- techcrunch:科技媒体,实体多为 company/product/person
- 36kr:中文产业媒体,实体多为 company/product
- zhihu:中文社区讨论,实体多为 technology/company
- github:开源仓库,实体多为 repository/framework/language

必须调用 extract_event 工具返回结果。`;

/**
 * 构建用户消息
 */
function buildUserMessage(item) {
  const parts = [
    `数据源: ${item.sourceType}`,
    `标题: ${item.title}`,
    `发布时间: ${item.publishedAt}`,
    `语言: ${item.language}`,
  ];
  if (item.url) parts.push(`URL: ${item.url}`);
  if (item.summary) parts.push(`摘要: ${item.summary}`);
  if (item.rawContent && item.rawContent !== item.summary) {
    parts.push(`原始内容:\n${item.rawContent.slice(0, 1500)}`);
  }
  if (Object.keys(item.metadata || {}).length > 0) {
    parts.push(`元数据: ${JSON.stringify(item.metadata)}`);
  }
  parts.push('\n请调用 extract_event 工具抽取结构化信息。');
  return parts.join('\n');
}

/**
 * 从 API 响应中提取 tool_use block 的 input
 */
function extractToolUseInput(response) {
  const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolUseBlock) {
    throw new Error('响应中无 tool_use block,模型未调用工具');
  }
  return { input: toolUseBlock.input, toolUseId: toolUseBlock.id, raw: toolUseBlock };
}

/**
 * 抽取单条(带重试)
 * 返回值含 usage 累加(每次调用都消耗 token,重试也要计入)
 */
async function extractOne(item) {
  const userMessage = buildUserMessage(item);
  const messages = [{ role: 'user', content: userMessage }];
  const usages = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().messages.create({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [EVENT_TOOL],
        tool_choice: { type: 'tool', name: 'extract_event' },
        messages,
      });

      if (response.usage) usages.push(response.usage);

      const { input, toolUseId } = extractToolUseInput(response);

      // Zod 运行时校验
      const result = EventSchema.safeParse(input);
      if (result.success) {
        console.log(`  [extractor] ✅ ${item.sourceType}:${item.title.slice(0, 40)}... (attempt ${attempt + 1})`);
        return { event: result.data, rawItem: item, attempts: attempt + 1, usages };
      }

      // 校验失败:把错误喂回模型重试
      const errorMsg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.log(`  [extractor] ⚠️ 校验失败(attempt ${attempt + 1}): ${errorMsg.slice(0, 100)}`);

      if (attempt < MAX_RETRIES) {
        messages.push({
          role: 'assistant',
          content: response.content,
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              is_error: true,
              content: `Schema 校验失败: ${errorMsg}。请修正后重新调用 extract_event。`,
            },
          ],
        });
      } else {
        console.log(`  [extractor] ❌ 达到最大重试次数,跳过: ${item.title.slice(0, 40)}...`);
        return { event: null, rawItem: item, error: errorMsg, attempts: attempt + 1, usages };
      }
    } catch (err) {
      console.error(`  [extractor] ❌ API 错误(attempt ${attempt + 1}): ${err.message}`);
      if (attempt === MAX_RETRIES) {
        return { event: null, rawItem: item, error: err.message, attempts: attempt + 1, usages };
      }
    }
  }
  return { event: null, rawItem: item, error: 'unknown', attempts: MAX_RETRIES + 1, usages };
}

/**
 * Map 阶段:并发抽取所有 items
 * @param {Array} items
 * @returns {Promise<{events: Array, failures: Array, stats: Object}>}
 */
export async function extractAll(items) {
  console.log('=== Map 阶段:逐条 Tool Use 抽取 ===');
  console.log(`待抽取: ${items.length} 条,并发 ${CONCURRENCY}\n`);

  const limit = pLimit(CONCURRENCY);
  const results = await Promise.all(
    items.map((item) =>
      limit(() => extractOne(item).catch((err) => ({
        event: null,
        rawItem: item,
        error: err.message,
        attempts: 0,
      })))
    )
  );

  const events = results.filter((r) => r.event).map((r) => r.event);
  const failures = results.filter((r) => !r.event);

  // 统计重试情况:首次成功 vs 重试后成功
  const firstTrySuccess = results.filter((r) => r.event && r.attempts === 1).length;
  const retriedSuccess = results.filter((r) => r.event && r.attempts > 1).length;

  // 聚合 token 使用量与成本(所有调用,含失败重试)
  const allUsages = results.flatMap((r) => r.usages || []);
  const tokenUsage = aggregateUsage(allUsages);

  const stats = {
    total: items.length,
    success: events.length,
    failed: failures.length,
    firstTrySuccess,
    retriedSuccess,
    totalAttempts: results.reduce((sum, r) => sum + (r.attempts || 0), 0),
    cacheStats: { enabled: true, model: getModel() },
    tokenUsage,
  };

  console.log(`\n=== Map 完成:成功 ${events.length}/${items.length}(首次 ${firstTrySuccess} + 重试 ${retriedSuccess}),失败 ${failures.length} ===`);
  console.log(`    Token: 输入 ${tokenUsage.input_tokens} + 输出 ${tokenUsage.output_tokens} + 缓存读 ${tokenUsage.cache_read_input_tokens} + 缓存写 ${tokenUsage.cache_creation_input_tokens} = ${tokenUsage.totalTokens}`);
  console.log(`    缓存命中率: ${(tokenUsage.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`    成本估算: $${tokenUsage.costEstimateUSD}(未开缓存 $${tokenUsage.costWithoutCacheUSD},省 ${tokenUsage.savingsPercent}%)\n`);

  if (failures.length > 0) {
    console.log('失败列表:');
    failures.forEach((f) => console.log(`  - ${f.rawItem.sourceType}: ${f.rawItem.title.slice(0, 50)}... | ${f.error?.slice(0, 80)}`));
  }

  return { events, failures, stats };
}

export { extractOne };
