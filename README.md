# AI Insight Engine - AI 舆情分析日报系统

> 从每日 AI 资讯中提取结构化洞察,生成可读的分析报告与可视化 Dashboard
> Vue 3 + JavaScript + Anthropic SDK + AntV G6

![status](https://img.shields.io/badge/status-active-success) ![tech](https://img.shields.io/badge/Vue-3.4-brightgreen) ![ai](https://img.shields.io/badge/AI-GLM--4.7%20via%20Anthropic%20SDK-blue) ![tests](https://img.shields.io/badge/tests-31%20passed-brightgreen)

---

## 📋 目录

- [项目简介](#项目简介)
- [快速开始](#快速开始)
- [数据源说明](#数据源说明)
- [系统设计思路](#系统设计思路)
- [AI 使用方式](#ai-使用方式)
- [核心流程说明](#核心流程说明)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [输出示例](#输出示例)
- [项目亮点](#项目亮点)

---

## 项目简介

本系统从多数据源(论文/媒体/社区/聚合平台)采集 AI 相关新闻,通过 **Map-Reduce Pipeline** 用 Anthropic SDK 的 **Tool Use** 强制 Schema 抽取结构化事件,再基于结构化数据生成日报分析(热点/趋势/风险)与可视化 Dashboard。模型走 GLM-4.7(经 Anthropic 兼容协议网关),代码兼容原生 Claude API。

---

## 快速开始

### 环境要求
- Node.js 20+
- Anthropic 兼容协议 API Key + Base URL + 模型名(支持 Claude 原生 API 或 GLM/Kimi/DeepSeek 等兼容协议代理)

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/xzfwyq/AI-Insight-Engine.git
cd AI-Insight-Engine

# 2. 安装所有依赖(根目录 Pipeline + web/ 前端,npm workspaces 一次搞定)
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key / Base URL / 模型名

# 4. 运行完整 Pipeline(采集 → 抽取 → 聚合 → 报告)
npm run pipeline

# 5. 启动前端 Dashboard
npm run dev
# 访问 http://localhost:5173
```

### 仅测试数据采集(不需要 API Key)

```bash
npm run fetch
# 抓取 6 实时源数据,保存到 data/processed/raw-items.json
```

### 运行测试

```bash
npm test          # 单元测试(31 个)
npm run lint      # ESLint
npm run build     # 前端构建
```

---

## 数据源说明

### 原始数据文件位置

| 文件 | 说明 |
|---|---|
| `data/raw/*.cache.json` | 7 个数据源的实时抓取缓存(运行时生成,`.gitignore` 不提交,降级用) |
| [`data/raw/github.json`](data/raw/github.json) | GitHub Trending 静态数据(手动整理,仓库内唯一提交的 raw 文件) |
| [`data/processed/raw-items.json`](data/processed/raw-items.json) | 合并后的原始数据(25 条,清洗前) |
| [`data/processed/cleaned-items.json`](data/processed/cleaned-items.json) | 清洗去重后数据(25 条) |
| [`data/sources.json`](data/sources.json) | 数据源配置 + 选择理由(结构化) |

### 数据源矩阵(四类全覆盖,6 实时 + 1 静态)

| 类别 | 选择 | 方式 | 语言 | 字段 |
|---|---|---|---|---|
| 科技媒体-中文 | 36氪 | 实时 RSS | CN | title/link/pubDate/description |
| 科技媒体-英文 | TechCrunch AI | 实时 RSS | EN | title/link/creator/pubDate/category |
| 社区-中文 | 知乎热榜 | 实时 API(关键词过滤) | CN | title/excerpt/热度/answer_count |
| 社区-英文 | Dev.to (tag=ai) | 实时 API | EN | title/description/tags/reactions/cover_image |
| 聚合平台 | Hacker News (Algolia) | 实时 API | EN | title/story_text/points/num_comments |
| 官方渠道-论文 | HuggingFace Daily Papers | 实时 API | EN | paper.id/title/summary/authors |
| 官方渠道-开源 | GitHub Trending | 静态 JSON | EN | repo/description/stars/forks/language |

### 数据源选择理由

选型逻辑详见 [数据源配置](data/sources.json)。

### 数据特点

- **多源互补**:论文(技术趋势)+ 媒体(产业报道)+ 社区(舆论热度)+ 开源(工程实践)
- **中英混合**:中文 7 条 + 英文 18 条,覆盖国内外视角
- **实时+静态**:6 实时源展示工程能力,1 静态源保证可复现
- **字段丰富**:每个源保留特有元数据(论文作者/HN 热度/Dev.to 反应数/GitHub stars 等)

---

## 系统设计思路

### 整体架构

```
数据采集层 → 清洗层 → Map 抽取层 → Reduce 聚合层 → 报告生成层 → 前端展示层
```

详见 [架构文档](docs/architecture.md)。

### Schema 设计

Schema 根据 7 种数据源特点设计,在 3 个维度做调整:`source.metadata` 用可选字段兼容各源特有元数据;`entities.type` 扩展到 12 种覆盖学术和开源实体;`rawContentType` 标注原始内容形态指导下游分析策略。

---

## AI 使用方式

详见 [AI 使用说明](docs/ai-usage.md)。核心:

### 两个 AI 调用场景

**场景1: Map 阶段(逐条结构化抽取)**
- 每条新闻独立调用 LLM,Tool Use 强制 Schema
- `tool_choice: {type:"tool", name:"extract_event"}` 保证必调 tool
- 手写内联 JSON Schema(无 `$ref`,兼容 GLM 网关)
- Zod 运行时校验,失败把错误喂回模型重试(最多 2 次)
- p-limit 并发 3,避免 rate limit

**场景2: Reduce 阶段(跨条聚合分析)**
- **不喂原始新闻**,只喂 Map 产出的结构化 Event 数组
- 代码统计:实体频次/主题分布/情感均值
- AI 总结:热点 Top5 + 趋势分析 + 风险提示

### 错误处理(三层降级)

1. API 错误:重试 2 次
2. Schema 校验失败:把 Zod 错误喂回模型修正
3. 数据源抓取失败:降级到上次缓存

Pipeline 自动统计 token 用量和成本估算,写入 `data/processed/pipeline-stats.json`。

---

## 核心流程说明

### 从原始数据到最终报告的完整流程

```
Step 1: 数据采集 (fetcher.js)
  ├─ HuggingFace Daily Papers API → 5 篇论文
  ├─ TechCrunch AI RSS → 4 篇文章
  ├─ 36氪 RSS → 4 篇 AI 文章(关键词过滤)
  ├─ 知乎热榜 API → 3 条 AI 相关(关键词过滤)
  ├─ Dev.to API → 3 篇 AI 文章
  ├─ HN Algolia API → 1-3 条讨论(score≥30)
  └─ GitHub Trending(静态) → 6 个仓库
  ↓
Step 2: 数据清洗 (cleaner.js)
  ├─ 字段标准化(时间/字符串 trim)
  ├─ 语言检测(中文占比 >15% 判定 zh)
  ├─ 稳定 ID 生成(sha1 哈希)
  └─ 去重(按 ID + 跨源标题相似度)
  ↓
Step 3: Map 抽取 (extractor.js) — 核心
  ├─ 并发 3 调用 LLM
  ├─ Tool Use 强制 Schema
  ├─ Zod 运行时校验
  └─ 失败重试(最多 2 次,把错误喂回模型)
  ↓
Step 4: Reduce 聚合 (aggregator.js)
  ├─ 主题归一化:52 个 AI 自由生成的主题 → 14 个标准主题(Map-Reduce 架构价值)
  ├─ 代码统计:实体频次/主题分布/情感均值/语言分布
  ├─ 热度评分:按数据源归一化(GitHub log10 stars / Dev.to reactions / 知乎热度 / significance 兜底)
  ├─ 风险预警:负面+行业级影响 → high/medium/low 三级
  └─ AI 总结:热点 Top5 + 趋势分析 + 风险提示(只喂结构化数据)
  ↓
Step 5: 报告生成 (markdown.js)
  ├─ data/processed/events.json (结构化 Event 数组)
  ├─ data/processed/aggregated.json (聚合分析 + enrichedEvents)
  └─ data/processed/report.md (Markdown 日报)
  ↓
Step 6: 前端展示 (web/)
  ├─ AI 简报(headline + 3 条核心要点 keyPoints)
  ├─ 风险预警区(高/中/低三级卡片 + 风险/机会双栏)
  ├─ 筛选状态条(语言/来源/实体/主题,显式展示活跃筛选)
  ├─ 事件时间分布(ECharts 散点图,X 时间 Y 热度,气泡大小=实体数,颜色=情感)
  ├─ 事件列表(精选 Top5 / 全部模式切换 + 热度分数)
  ├─ 事件详情钻取(原文/AI 分析/实体/情感/影响/热度进度条)
  └─ 知识图谱(实体+主题统一视图,三种连边,视图切换)
```

---

## 项目结构

```
ai-insight-engine/
├── data/
│   ├── raw/                  # 原始数据
│   │   ├── github.json       # 静态 GitHub Trending
│   │   └── *.cache.json      # 实时抓取缓存(降级用)
│   ├── processed/            # Pipeline 产出
│   │   ├── events.json       # 结构化 Event 数组
│   │   ├── aggregated.json   # 聚合分析
│   │   └── report.md         # Markdown 日报
│   └── sources.json          # 数据源配置与选择理由
├── src/
│   ├── schema/
│   │   └── event.js          # Zod EventSchema + AggregatedReportSchema
│   ├── pipeline/
│   │   ├── fetcher.js        # 6 实时源抓取 + 静态加载
│   │   ├── cleaner.js        # 去重/标准化/语言检测
│   │   ├── extractor.js      # Map: Tool Use 抽取(核心)
│   │   ├── aggregator.js     # Reduce: 统计 + AI 总结
│   │   └── runner.js         # Pipeline 编排
│   └── reporter/
│       └── markdown.js       # 日报生成
├── scripts/
│   └── run-pipeline.mjs      # 一键运行入口
├── tests/
│   ├── extractor.test.js     # Schema 校验/去重/语言检测
│   └── lexicon.test.js       # 词典情感分析(150 词正负面/否定/程度副词)
├── web/                      # Vue 3 前端
│   ├── src/
│   │   ├── views/Dashboard.vue
│   │   ├── components/       # InsightHeader/RiskAlerts/FilterBar/EventList/EventDetail/KnowledgeGraph
│   │   ├── stores/events.js  # Pinia
│   │   └── api/index.js      # 数据加载
│   └── vite.config.js
├── docs/
│   ├── architecture.md       # 架构图
│   └── ai-usage.md           # AI 使用说明
├── .github/workflows/ci.yml  # GitHub Actions CI
├── .env.example
└── README.md
```

---

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 前端框架 | Vue 3 + Vite | 3.4 / 5.4 |
| 语言 | JavaScript + JSDoc(`// @ts-check`) | ES2022 |
| 状态管理 | Pinia | 2.2 |
| 图表 | ECharts (vue-echarts) | 5.5 / 7.0 |
| 实体关系图 | AntV G6 | 5.0 |
| 后端/Pipeline | Node.js + ES Modules | 20+ |
| AI SDK | @anthropic-ai/sdk | 0.32 |
| AI 模型 | glm-4.7(经 Anthropic 兼容协议网关,兼容原生 Claude) | - |
| Schema 校验 | Zod(运行时校验)+ 手写内联 JSON Schema(Tool Use) | 3.23 |
| 测试 | Vitest | 2.1 |
| 工程化 | ESLint + Prettier + husky + commitlint | - |
| CI | GitHub Actions | - |

---

## 输出示例

### 数据产出

- [`data/processed/events.json`](data/processed/events.json) — 结构化 Event 数组(25 条,含主题归一化 + 词典情感 + heatScore)
- [`data/processed/aggregated.json`](data/processed/aggregated.json) — 聚合分析(headline/keyPoints/trends/risks/opportunities 结构化字段)
- [`data/processed/report.md`](data/processed/report.md) — Markdown 日报
- [`data/processed/pipeline-stats.json`](data/processed/pipeline-stats.json) — Pipeline 统计(token 用量/成本/耗时)

### 日报结构(前端 Dashboard)

| 区块 | 对应题目要求 | 数据来源 |
|---|---|---|
| AI 简报(headline + keyPoints) | 信息快速理解 | AI Reduce 阶段生成 |
| 风险预警(高/中/低三级卡片) | 舆情监测与风险预警 | 代码规则提取 |
| 筛选状态条 + 搜索 | 交互 | — |
| 事件时间分布散点图 | 可视化展示 | ECharts |
| 事件列表 + 详情钻取(含 Top5 入选理由高亮) | 信息结构化结果展示 + 重要事件深度总结 | Map 产出 + topEvents join |
| 知识图谱(实体+主题,可放大) | 可视化展示 | G6 力导向 |
| 趋势分析(分栏 bullet) | 趋势判断(技术/应用/竞争/资本/政策) | AI Reduce + 主题归一化 |
| 风险与机会(红绿双栏) | 风险或机会提示 | AI Reduce 生成 |

### aggregated.json 结构化字段(新增,对标 TLDR/CB Insights)

```json
{
  "headline": "Apple 起诉 OpenAI 窃密叠加黄仁勋宣告 Prompt 已死,AI 竞争进入法律与范式双重博弈",
  "keyPoints": [
    { "text": "苹果起诉 OpenAI 系统性窃密,400+ 前苹果员工已入职", "eventId": "zhihu_xxx" },
    { "text": "黄仁勋宣告 Prompt 已死,Anthropic 80% 工程师转向 Loop", "eventId": "zhihu_yyy" }
  ],
  "trends": [
    { "dimension": "技术", "bullets": [{ "text": "...", "eventId": "hf_papers_zzz" }] }
  ],
  "risks": [{ "title": "IP 合规风险上升", "description": "...", "eventId": "techcrunch_aaa" }],
  "opportunities": [{ "title": "Loop Engineering 工具链蓝海", "description": "...", "eventId": "zhihu_bbb" }],
  "topEvents": [{ "id": "...", "title": "...", "significance": 0.95, "reason": "..." }]
}
```

### 前端 Dashboard

信息流式布局(从上到下):
1. **AI 简报** — 今日洞察一句话(headline)+ 3 条核心要点 keyPoints(可点击跳转)
2. **风险预警区** — 高/中/低三级卡片 + 风险/机会红绿双栏(决策辅助核心)
3. **筛选状态条** — 语言/来源/实体/主题,显式展示活跃筛选
4. **事件时间分布** — ECharts 散点图(X 时间 Y 热度,气泡大小=实体数,颜色=情感,点击钻取)
5. **主体信息流** — 左:事件列表(精选 Top5 / 全部模式);右:事件详情钻取(含 Top5 入选理由高亮)
6. **知识图谱** — 实体+主题统一视图(G6 力导向,三种连边,视图切换,画中画放大)
7. **趋势深度分析** — AI 生成的趋势判断 + 风险与机会

**交互**:
- 点击时间散点 → 选中事件,右侧详情面板展开
- 点击知识图谱节点 → 筛选事件列表(实体节点筛实体,主题节点筛主题)
- 点击事件列表项 → 右侧详情面板展开
- 顶部筛选 → 联动所有视图(时间散点、列表、图谱同步)
- 知识图谱支持"全部/仅实体/仅主题"视图切换

---

## 项目亮点

1. **可复现 Pipeline**: `npm run pipeline` 从原始数据到日报,7 源采集 → Tool Use 抽取 → 聚合 → 报告
2. **Dashboard 联动**: 时间散点图、知识图谱、事件列表、详情面板四向联动,知识图谱支持画中画放大
3. **工程化**: 31 个单测 + CI + ESLint + commitlint + husky,完整文档

---

## License

MIT
