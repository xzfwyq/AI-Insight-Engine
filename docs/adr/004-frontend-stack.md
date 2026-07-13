# ADR-004: 前端技术栈决策

**状态**: Accepted
**日期**: 2026-07-12

## 背景
前端技术栈选择需平衡:1) 主栈熟悉度(Vue+JS),2) Dashboard 展示效果,3) 工期可控。

## 决策
采用 Vue 3 + JavaScript 技术栈:

| 层 | 选型 |
|---|---|
| 框架 | Vue 3 + Vite 5 |
| 语言 | JavaScript + JSDoc |
| 状态 | Pinia |
| UI | 自定义 CSS(暗色 Dashboard 风格) |
| 图表 | ECharts (vue-echarts) |
| 实体关系图 | AntV G6 v5 |

## 理由

### 为什么 Vue 3 而非 React
- 主栈是 Vue,响应式原理、Composition API、Pinia 设计能讲深
- Vue 3 + Vite 5 是当前 Vue 生态标配

### 为什么 JavaScript 而非 TypeScript
- 主栈是 JS,坚持用 TS 会增加认知负担
- 用 JSDoc + `// @ts-check` 在 JS 项目里体现类型思维
- Zod 做运行时校验,类型安全在边界处保证

### 为什么 AntV G6 而非 ReactFlow/d3-force
- G6 专为图分析设计,力导向布局原生支持
- 蚂蚁出品,金融场景常见
- 节点/边定制能力强,按实体类型着色
- vue-flow 是节点编辑器,力导向非其设计目标
- d3-force 自由度高但需自建交互层,工作量过大

### 为什么 ECharts 而非 Chart.js
- 国产,金融/舆情场景标配
- 时间线散点图、主题气泡图都能高质量呈现
- vue-echarts 封装成熟,按需引入减小 bundle

### 为什么自定义 CSS 而非 Naive UI
- Dashboard 主要是数据展示,自定义 CSS 更轻量
- 暗色主题自己写更可控,且 bundle 更小
- 减少依赖

## 后果
- **优点**:bundle 可控,展示效果好
- **缺点**:G6 v5 API 较新,文档不如 v4 丰富,需查阅
- **权衡**:G6 v5 是当前主流,v4 已 deprecated
