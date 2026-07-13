# ADR-003: AI Pipeline 架构决策

**状态**: Accepted
**日期**: 2026-07-12

## 背景
题目明确要求"❌ 不允许将原始数据直接一次性丢给 AI 让其生成全部结果",且"必须体现处理逻辑(数据清洗、分批处理、结果校验等)"。

## 决策
采用 Map-Reduce Pipeline 架构:

```
原始数据 → 清洗/去重 → Map(逐条 Tool Use 抽取) → Zod 校验 → 失败重试 → Reduce(跨条聚合) → 报告生成
```

### Map 阶段(逐条抽取)
- 每条新闻独立调用 Claude,用 Tool Use 强制 Schema
- `tool_choice: { type: "tool", name: "extract_event" }` 保证必调 tool
- `input_schema` 由 `zod-to-json-schema(EventSchema)` 自动生成
- Zod 运行时校验,失败把错误喂回模型重试(最多 2 次)
- p-limit 控制并发 3,避免 rate limit
- Prompt caching: system + tool 定义加 cache_control

### Reduce 阶段(跨条聚合)
- **不喂原始新闻**,只喂 Map 产出的结构化 Event 数组
- 代码统计:实体频次、主题分布、情感均值、语言分布
- AI 总结:基于结构化数据生成热点 Top5、趋势分析、风险提示

## 理由

### 为什么用 Tool Use 而非 JSON.parse
- Tool Use + tool_choice 强制模型按 Schema 返回,从 `tool_use.input` 直接取结构化数据
- JSON.parse 自由文本有 3 个问题:
  1. 模型可能输出额外文字(如 "```json")导致解析失败
  2. 字段缺失或类型错误无法提前约束
  3. 失败重试需要重新构造 prompt,成本高

### 为什么 Map-Reduce 而非一次性调用
- 一次性调用受 token 限制(20 条新闻原文 > 10K tokens),且违反题目要求
- Map 阶段并发抽取,每条独立校验,失败不影响其他
- Reduce 阶段基于结构化数据,token 消耗低,且可复现

### 为什么 Reduce 不喂原始新闻
- 题目明确禁止"一次性丢原始数据给 AI"
- Map 产出的 Event 已是结构化,包含 entities/topics/sentiment/impact
- Reduce 基于这些结构化字段做统计 + AI 总结,既做了跨条分析又不违反规则

### 为什么 Zod 校验 + 失败重试
- AI 输出不可信,必须运行时校验
- Zod safeParse 返回详细错误,把错误喂回模型让它修正
- 最多重试 2 次,平衡成本和成功率

### 为什么 p-limit 并发 3
- Anthropic API rate limit:50 req/min (Sonnet)
- 并发 3 + 每条平均 3s = 60 req/min,接近上限
- 失败重试时不会触发 rate limit

## 后果
- **优点**:可复现、可校验、可解释,符合题目要求
- **成本**:20 条新闻约 $0.05(Sonnet 4.6,Map + Reduce)
- **缺点**:Map 阶段 20 条并发 3,总耗时约 20-30s
