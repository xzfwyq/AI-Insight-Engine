# AI 使用方式说明

## 整体策略

本项目使用 Claude API(经 Anthropic 兼容协议网关调用 GLM-4.7)的两个核心能力:
1. **Tool Use**:强制模型按 Schema 返回结构化数据(非 JSON.parse 自由文本)
2. **Prompt Caching**:缓存 system + tool 定义,降低重复成本

> **注**:模型实际走内部 GLM 网关,但协议与 Anthropic SDK 兼容。成本估算按 Claude Sonnet 4.6 公开价格作为"等价成本"参考。

## AI 调用场景

### 场景1:Map 阶段 — 逐条结构化抽取

**目的**:从每条新闻中抽取结构化 Event(entities/topics/sentiment/impact)

**System Prompt 设计**(项目背景 + 角色 + 规则):

```
你是专业的新闻结构化抽取器。任务:从一条新闻/论文/讨论中抽取结构化 Event 信息。

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

必须调用 extract_event 工具返回结果。
```

**User 消息构造**:
```
数据源: 36kr
标题: 全网骂 Claude 变笨,Anthropic 下场揭秘
发布时间: 2026-07-12T13:47:23Z
语言: zh
摘要: ...
原始内容: ...(截断到 1500 字)
元数据: {...}

请调用 extract_event 工具抽取结构化信息。
```

**Tool 定义**(手写内联 JSON Schema,非 zod-to-json-schema):
```javascript
{
  name: 'extract_event',
  description: '从新闻/论文/讨论中抽取结构化事件信息',
  input_schema: EVENT_TOOL_SCHEMA,  // 手写,无 $ref
}
```

> **为什么手写而非 zod-to-json-schema**:见 [ADR-006](adr/006-tool-use-inlined-schema.md)。zod-to-json-schema 默认生成带 `$ref` 的 Schema,GLM 兼容网关不支持 `$ref`,会导致 `tool_use.input` 返回空 `{}`。

**强制调用**:
```javascript
tool_choice: { type: 'tool', name: 'extract_event' }
```

**失败重试**:
Zod 校验失败 → 把错误以 `tool_result(is_error:true)` 喂回 → 模型修正 → 最多重试 2 次

### 场景2:Reduce 阶段 — 跨条聚合分析

**目的**:基于 Map 产出的结构化 Event 数组,生成结构化日报分析

**关键设计**:**不喂原始新闻**,只喂结构化 Event(已含 entities/topics/sentiment/impact,且经主题归一化 + 词典情感覆盖)

**System Prompt 设计**(对标优秀 prompt 模版,含项目背景+用户画像+输出规范):

```
# 角色
你是 AI 行业资深分析师兼舆情研判专家,具备 10 年以上 AI/科技产业研究经验,擅长从碎片化资讯中提炼趋势、识别风险与机会,输出结构化、可决策的日报分析。

# 项目背景
本系统用于从每日新闻信息中提取结构化洞察,生成可读的分析报告与可视化结果,服务于三大应用场景:
1. AI 行业趋势分析 — 技术演进、应用落地、竞争格局、资本流向
2. 舆情监测与风险预警 — 负面事件识别、知识产权/合规/声誉风险预警
3. 信息快速理解与决策辅助 — 帮助用户在 30 秒内抓住当日要点,辅助投资/研发/战略决策

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

## trends(按维度分栏,bullet 形式)
- 维度:技术 / 应用 / 竞争 / 资本 / 政策
- 每栏 2-3 条 bullet,每条一句话引用"事件N"

## risks(1-3 条风险)/ opportunities(1-3 条机会)
- 每条 {title(10-20字) + description(30-60字) + eventId}

## topEvents(3-5 个最重要事件)
- 按 significance 0-1 排序,id 从输入数据复制

# 核心原则
1. 每个论点必须引用具体事件(用"事件N"指代),不要空洞描述
2. bullet 形式,不要大段文字(用户扫读,不细读)
3. risks 和 opportunities 分开(风险=规避,机会=抓取,决策动作不同)
4. 具体优于抽象
5. 不发挥不推测,只基于输入数据

必须调用 aggregate_report 工具返回结果。
```

**User 消息**:
```
以下是从多个数据源结构化抽取的 ${events.length} 条 AI 相关事件(已过 Map 阶段 + 主题归一化 + 词典情感,非原始新闻)。

请基于这些结构化数据,生成日报分析:
- headline: 一句话总结今日核心趋势
- keyPoints: 3 个要点(每个引用具体 eventId)
- trends: 按维度分栏(技术/应用/竞争/资本/政策),bullet 形式
- risks: 1-3 条风险
- opportunities: 1-3 条机会
- topEvents: 3-5 个最重要事件

结构化数据(JSON,事件编号用于引用):
[compactEvents...]

请调用 aggregate_report 工具返回结果。所有 eventId 必须从上面数据中复制。
```

## 非调用 AI 的分析步骤(代码完成,体现"结构化处理")

以下分析**不用 AI**,纯代码完成,体现题目要求的"处理逻辑":

| 步骤 | 实现 | 说明 |
|---|---|---|
| 主题归一化 | `aggregator.js: TOPIC_TAXONOMY` | 78 个 AI 自由主题 → 15 个标准主题(ADR-007) |
| 词典情感分析 | `sentiment/lexicon.js` | 覆盖 AI 自由判断,可复现可审计(ADR-008) |
| 热度评分 | `aggregator.js: computeHeatScore` | 按数据源归一化(GitHub log10 stars / Dev.to reactions / 知乎热度) |
| 风险预警 | `aggregator.js: extractRiskAlerts` | 规则:负面+行业级影响 → high/medium/low |
| 实体频次 | `aggregator.js: topEntities` | 代码统计,不调 AI |
| 情感概览 | `aggregator.js: sentimentOverview` | 代码统计正负面分布 |

## 为什么不一次性丢给 AI(题目核心要求)

| 方式 | 问题 |
|---|---|
| ❌ 一次性丢 20 条原文 | 违反题目要求;token 消耗大(>10K);无法校验;不可复现 |
| ✅ Map-Reduce | 符合题目要求;每条独立校验;可并发;Reduce 基于结构化数据,token 小且可复现 |

## 成本控制

### Prompt Caching
- System prompt + tool 定义加 `cache_control: {type: 'ephemeral'}`
- 25 条新闻共用同一 system + tool,缓存命中率高
- 实测:命中率 62.1%,省 17.5%(见 `pipeline-stats.json`)

### 模型选择
- `glm-4.7`(经 Anthropic 兼容网关)
- 成本按 Claude Sonnet 4.6 公开价格估算:$3/$15 per 1M tokens
- 25 条新闻 Map + Reduce 实测 ~$0.43

### 并发控制
- p-limit 并发 3,避免 rate limit
- 25 条总耗时 ~3 分钟(含 Reduce)

## 错误处理

### 三层降级
1. **API 错误**:重试 2 次
2. **Schema 校验失败**:把 Zod 错误喂回模型,让它修正(最多 2 次)
3. **数据源抓取失败**:降级到上次缓存(`data/raw/*.cache.json`)

### 失败统计
- `data/processed/extract-failures.json` 记录所有失败 case(当前 0 个)
- `data/processed/pipeline-stats.json` 记录每阶段耗时、成功率、token 用量、成本

### 踩坑记录
1. **GLM $ref bug**:`zod-to-json-schema` 生成带 `$ref` 的 Schema,GLM 网关不支持,`tool_use.input` 返回空 `{}`。手写内联 Schema 解决(ADR-006)
2. **Schema 校验不一致**:`AggregatedReportSchema` 包含代码统计字段,AI 不生成导致校验失败。拆出 `AiSummarySchema` 只校验 AI 字段
3. **summary 超长**:`max(300)` 过严,AI 首次常超 → 重试浪费 token。prompt 明确"150-250 字,超 300 拒绝" + Zod 放宽到 400 字双保险
