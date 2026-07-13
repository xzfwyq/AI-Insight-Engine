# ADR-002: Schema 设计决策

**状态**: Accepted
**日期**: 2026-07-12

## 背景
题目要求设计结构化数据模型,且"鼓励根据你的数据源特点调整 schema","不允许仅做 summary"。

## 决策
设计 Event Schema,在 3 个维度响应数据源特点:

### 维度1: source.metadata 用可选字段兼容多源特有元数据
- hf_papers: authors[]、paperId
- hn: score、commentsCount
- devto: reactionsCount、tags[]、coverImage
- github: stars、forks、repoLanguage
- techcrunch/36kr: author、category
- zhihu: heat、answerCount

### 维度2: entities.type 扩展到 12 种,覆盖学术和开源实体
- 通用: company/product/technology/person/organization
- 学术源特有: paper/dataset/method/benchmark
- 开源源特有: repository/framework/language

### 维度3: rawContentType 标注原始内容形态
- abstract(hf_papers 论文摘要,偏技术)
- discussion(hn 讨论帖,偏观点)
- article(devto/techcrunch 文章,偏应用/产业)
- readme(github README,偏功能)
- news(36kr/zhihu 新闻/热榜,偏事件)

## 理由

### 为什么用可选字段而非 7 个独立 Schema
- Pipeline 统一处理,不需要按 source type 分发
- Zod optional() 让缺失字段通过校验
- 前端渲染时按 source type 展示特有字段即可
- 避免 Schema 爆炸(7 个 Schema 难以维护)

### 为什么 entities.type 扩展到 12 种
- 不同源产生不同实体类型:论文抽 paper/method,仓库抽 repository/framework,新闻抽 company/product
- 图谱节点按类型着色(论文/仓库/公司/人物各一色),可视化更清晰
- 下游分析可按实体类型聚合(如"本周热门论文 Top5")

### 为什么加 rawContentType
- 指导下游分析策略:论文摘要做技术趋势,HN 讨论做舆情情感,新闻做事件影响
- 前端展示时按内容形态调整样式(论文显示作者,讨论显示 score)

### 为什么不只有 summary
- summary 只能做"事件列表",无法支撑"趋势/情感/影响/关系"4 个分析维度
- entities 支撑关系图谱
- topics 支撑趋势统计
- sentiment 支撑情感分析
- impact 支撑风险/机会预警
- 这些字段让日报有"分析深度",不只是"信息罗列"

## 后果
- **优点**:Schema 统一处理 + 保留各源特有信息 + 支撑 4 维度分析
- **缺点**:metadata 字段较多,部分源的部分字段可能为空
- **权衡**:用 Zod optional() 处理,前端按需展示
