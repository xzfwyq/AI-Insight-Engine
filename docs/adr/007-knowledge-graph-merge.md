# ADR-007: 实体图 + 主题图合并为知识图谱 + 主题归一化

**状态**: Accepted
**日期**: 2026-07-12

## 背景

初版前端 Dashboard 有两个独立可视化:
1. **实体共现网络**(G6 力导向)— Top 15 实体,按类型着色
2. **主题分布气泡图**(ECharts treemap)— 全部 78 个主题,按类别分组

用户反馈两个问题:
1. 主题 treemap 里 78 个主题有 72 个频次为 1,方块小到看不见,长尾严重
2. 实体图和主题图分两部分的意义是什么?用户看不到实体和主题的关联

## 问题诊断

### 长尾问题的根因

Map 阶段每条事件独立调用 Claude,AI 自由生成主题词。24 条事件产出 78 个不同主题,其中:
- "LLM"(8)/"Agent"(7)/"开源模型"(5) 等高频主题
- "stance detection"/"contrastive learning"/"稀疏表示" 等 72 个频次为 1 的长尾

这不是前端能治本的 — 根因在 Map 阶段 AI 自由发挥,没有统一主题词表。

### 两个图分裂的根因

实体和主题本质都是"概念节点",分两个图等于割裂关联。用户看不到"LLM 主题常和哪些实体共现""Agent 主题关联哪些公司"这种跨维度洞察。

## 决策

### 决策1: Reduce 阶段做主题归一化

在 `aggregator.js` 加 `TOPIC_TAXONOMY`(15 个标准主题 + 同义词关键词表),Reduce 阶段把 AI 自由抽取的原始主题映射到标准主题。

```javascript
const TOPIC_TAXONOMY = [
  { canonical: '开源框架', keywords: ['开源框架', 'framework', '框架'] },
  { canonical: '开源模型', keywords: ['开源模型', 'open-source model', '开源'] },
  { canonical: 'Agent', keywords: ['agent', '智能体', 'autonomous', 'multi-agent'] },
  { canonical: 'LLM', keywords: ['llm', 'large language model', '大模型', 'foundation model'] },
  // ... 共 15 个
];
```

匹配规则:子串包含(忽略大小写),顺序敏感(特殊/长的词放前面,避免"开源"误吞"开源框架")。映射不上的归到"其他"。

### 决策2: 合并为单一知识图谱

新建 `KnowledgeGraph.vue`,把实体节点和主题节点放在同一张 G6 力导向图里:
- **实体节点**:12 种类型着色,大小 ∝ 频次,Top 12
- **主题节点**:5 种类别着色 + `#` 前缀,大小 ∝ 事件覆盖数,Top 8(频次 ≥ 2)
- **三种连边**:
  - 实体↔实体(蓝色)— 同一事件共现
  - 主题↔实体(绿色)— 主题覆盖某实体
  - 主题↔主题(紫色,默认隐藏)— 主题共现
- **视图切换**:全部 / 仅实体 / 仅主题
- **交互**:点击实体节点 → selectEntity;点击主题节点 → selectTopic(大小写不敏感)

### 决策3: 前端 store 优先用归一化后的事件

`web/src/stores/events.js` 的 load 函数改为:
```javascript
this.events = agg?.enrichedEvents?.length ? agg.enrichedEvents : ev;
```

这样前端知识图谱、事件列表、详情面板都用归一化后的主题(从 `aggregated.enrichedEvents` 读),而不是原始主题(从 `events.json` 读)。

## 理由

### 为什么在 Reduce 阶段做归一化,不在 Map 阶段

- Map 阶段每条独立抽取,没有全局视角,无法做跨条归一化
- Reduce 阶段能看到所有事件的主题,可以做归并
- **这是 Map-Reduce 架构的结构性价值** — 一次性丢给 AI 做不到归一化

### 为什么用子串匹配而非语义匹配

- 子串匹配确定性强,可复现,不依赖额外 AI 调用
- 同义词表可维护可审计,每个映射规则有据可查
- 语义匹配(embedding)需要额外 API 调用,MVP 阶段过度设计

### 为什么合并而非并列

- 实体和主题都是"概念节点",分两个图割裂关联
- 合并后能看到跨维度洞察(如"LLM 主题 ↔ Anthropic 实体"共现强)
- 单图加视图切换(全部/仅实体/仅主题)兼顾深度和清晰度
- 借鉴 Palantir Foundry / VOSviewer 的统一图视图设计

## 验证结果

### 主题归一化效果
```
78 个原始主题 → 16 个标准主题(15 个 + "其他")
"其他" 频次: 9(均为垂直领域:量子计算/综艺节目/新能源等,确实无法归入 AI 标准主题)
Top 5: LLM(15), Agent(8), 开源模型(5), 编程能力(5), 开源框架(3)
```

### 前端效果
- 知识图谱节点数:12 实体 + 14 主题 = 26(可读)
- 点击主题节点能正确筛选事件(大小写不敏感)
- 视图切换"仅实体/仅主题/全部"重新渲染

## 后果

- **优点**:主题长尾问题治本(52→14),图谱可读
- **优点**:实体+主题合并后能看到跨维度关联
- **优点**:主题归一化是 Map-Reduce 架构价值的最佳例证
- **缺点**:主题词表需要维护,新主题出现时要手动加同义词
- **权衡**:用一点维护成本换取可读性和可解释性,值得

## 设计要点

1. **Map-Reduce 的结构性价值**:Reduce 阶段做归一化,52→14,这是"一次性丢给 AI"做不到的
2. **产品思维**:发现实体图+主题图分裂的问题,借鉴 Palantir 合并为知识图谱
3. **工程权衡**:子串匹配 vs 语义匹配,选前者因为可复现可审计
4. **数据流设计**:前端优先用 aggregated.enrichedEvents,保证归一化主题全链路一致

## 取代

- 删除 `web/src/components/EntityGraph.vue`
- 删除 `web/src/components/TopicBubble.vue`
- 新建 `web/src/components/KnowledgeGraph.vue`
- 删除死代码 `HighlightBar.vue` / `KpiCard.vue` / `Timeline.vue`(早期迭代遗留)
