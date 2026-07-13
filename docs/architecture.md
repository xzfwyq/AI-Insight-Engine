# 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     数据采集层 (fetcher.js)                 │
│  ┌─────────┬──────────┬───────┬────────┬────────┬────────┐ │
│  │ HF Daily │TechCrunch│ 36氪  │ 知乎   │ Dev.to │  HN    │ │
│  │ Papers   │   RSS    │ RSS   │ API    │  API   │ Algolia│ │
│  └────┬────┴─────┬────┴───┬───┴────┬───┴────┬───┴────┬───┘ │
│       │          │        │        │        │        │      │
│       └──────────┴────────┴────────┴────────┴────────┘      │
│                            + GitHub Trending(静态 JSON)     │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────┐
│                    数据清洗层 (cleaner.js)                 │
│  字段标准化 / 语言检测 / 标题去重 / 稳定 ID 生成            │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────┐
│              Map 阶段 (extractor.js) — 核心                │
│  每条新闻独立调用 Claude,Tool Use 强制 Schema              │
│  ┌──────────────────────────────────────────────────┐     │
│  │  tool_choice: {type:"tool", name:"extract_event"}│     │
│  │  input_schema: zodToJsonSchema(EventSchema)      │     │
│  │  Zod 运行时校验 → 失败重试(最多 2 次)            │     │
│  │  p-limit 并发 3                                  │     │
│  └──────────────────────────────────────────────────┘     │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────┐
│           Reduce 阶段 (aggregator.js)                      │
│  主题归一化:78 个 AI 自由主题 → 15 个标准主题             │
│  代码统计:实体频次/主题分布/情感均值/语言分布              │
│  热度评分:按数据源归一化(GitHub/Dev.to/知乎/significance)│
│  风险预警:负面+行业级影响 → high/medium/low               │
│  AI 总结:热点 Top5 + 趋势分析 + 风险提示(只喂结构化数据) │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────┐
│           报告生成 (markdown.js) + 持久化                  │
│  data/processed/events.json       (Map 产出)               │
│  data/processed/aggregated.json   (Reduce 产出)            │
│  data/processed/report.md         (最终日报)               │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────┐
│           前端展示层 (web/ - Vue 3 Dashboard)              │
│  ┌──────────┬──────────────┬──────────────┐               │
│  │ AI 简报  │  风险预警    │  筛选状态条  │               │
│  │ (洞察+  │  (高/中/低   │  (语言/来源/ │               │
│  │  建议)  │   三级卡片)  │   实体/主题) │               │
│  ├──────────┴──────────────┴──────────────┤               │
│  │  事件时间分布(ECharts 散点:时间×热度) │               │
│  ├─────────────────────────────────────────┤               │
│  │  事件列表(精选/全部) ↔ 事件详情钻取   │               │
│  ├─────────────────────────────────────────┤               │
│  │  知识图谱(G6,实体+主题统一视图)       │               │
│  │  三种连边:实体共现/主题-实体/主题共现  │               │
│  ├─────────────────────────────────────────┤               │
│  │  趋势深度分析 + 风险与机会              │               │
│  └─────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────┘
```

## 关键设计决策

### 1. 为什么 Map-Reduce 而非一次性调用
- 题目明确禁止"一次性丢原始数据给 AI"
- Map 阶段每条独立抽取,失败不影响其他,可并发
- Reduce 阶段基于结构化数据(AI 已抽取),不喂原始新闻,既做跨条分析又不违反规则
- 详见 [ADR-003](adr/003-ai-pipeline.md)

### 2. 为什么 Tool Use 强制 Schema
- `tool_choice: {type:"tool", name:"extract_event"}` 保证模型必调 tool
- 从 `tool_use.input` 直接取结构化数据,不需要 JSON.parse 自由文本
- `input_schema` 由 `zodToJsonSchema(EventSchema)` 自动生成,Schema 单一来源
- 详见 [ADR-003](adr/003-ai-pipeline.md)

### 3. 为什么混合数据源(6 实时 + 1 静态)
- 实时源展示工程能力(API/RSS 抓取、代理管理、错误降级)
- 静态源(GitHub Trending)保证可复现,因为非官方 API 不稳定
- 详见 [ADR-001](adr/001-data-source.md)

### 4. 为什么 Schema 根据数据源特点调整
- source.metadata 用可选字段兼容 7 种数据源特有元数据
- entities.type 扩展到 12 种,覆盖学术(paper/dataset/method)和开源(repository/framework)
- rawContentType 标注原始内容形态,指导下游分析策略
- 详见 [ADR-002](adr/002-schema-design.md)

### 5. 为什么手写内联 Schema 而非 zod-to-json-schema
- `zod-to-json-schema` 默认生成带 `$ref` 的 Schema,GLM 兼容协议网关不支持 `$ref`
- 会导致 `tool_use.input` 返回空 `{}`,误判为网关 bug
- 手写完全扁平的 JSON Schema,无任何 `$ref`/`definitions`,所有网关都能正确处理
- 详见 [ADR-006](adr/006-tool-use-inlined-schema.md)

### 6. 为什么实体图+主题图合并为知识图谱,Reduce 阶段做主题归一化
- Map 阶段 AI 自由生成主题词,24 条事件产出 78 个主题,72 个频次为 1(长尾严重)
- Reduce 阶段用标准主题词表(15 个 canonical + 同义词)做跨条归一化,78→16
- 实体和主题本质都是"概念节点",分两个图割裂关联;合并后能看到跨维度洞察
- 详见 [ADR-007](adr/007-knowledge-graph-merge.md)

## 数据流

```
外部 API/RSS ──fetcher──▶ RawItem[] ──cleaner──▶ CleanedItem[]
                                                      │
                                                      ▼
                                            extractor (Map)
                                              │ (并发 3)
                                              ▼
                                            Event[] (Zod 校验)
                                              │
                                              ▼
                                            aggregator (Reduce)
                                              │
                                              ▼
                                            AggregatedReport
                                              │
                                              ▼
                                            markdown.js
                                              │
                                              ▼
                                    events.json + aggregated.json + report.md
                                              │
                                              ▼
                                        前端 Dashboard
```

## 模块职责

| 模块 | 职责 | 输入 | 输出 |
|---|---|---|---|
| `fetcher.js` | 6 实时源抓取 + 静态加载 | sources.json 配置 | RawItem[] |
| `cleaner.js` | 去重/标准化/语言检测 | RawItem[] | CleanedItem[] |
| `extractor.js` | Map: Tool Use 抽取 + Zod 校验 + 失败重试 | CleanedItem[] | Event[] |
| `aggregator.js` | Reduce: 主题归一化 + 统计 + 热度评分 + 风险预警 + AI 总结 | Event[] | AggregatedReport(含 enrichedEvents) |
| `markdown.js` | 报告生成 | Event[] + AggregatedReport | report.md |
| `runner.js` | Pipeline 编排 | options | 全流程产出 |
| `web/` | 前端 Dashboard | aggregated.json(enrichedEvents 优先) | 可视化界面 |
