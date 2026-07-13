# ADR-001: 数据源选型决策

**状态**: Accepted
**日期**: 2026-07-12

## 背景
题目要求从多个数据源获取 AI 相关近期新闻,中英文混合,至少 10-20 条。题目给出四类参考方向:科技媒体、官方渠道、社交媒体、聚合平台。

## 决策
采用 6 实时 + 1 静态的混合数据源策略:

| 类别 | 选择 | 方式 | 语言 |
|---|---|---|---|
| 科技媒体-中文 | 36氪 RSS | 实时 | CN |
| 科技媒体-英文 | TechCrunch AI | 实时 RSS | EN |
| 社区-中文 | 知乎热榜 API | 实时(关键词过滤) | CN |
| 社区-英文 | Dev.to (tag=ai) | 实时 | EN |
| 聚合平台 | HN Algolia | 实时 | EN |
| 官方渠道-论文 | HuggingFace Daily Papers | 实时 | EN |
| 官方渠道-开源 | GitHub Trending | 静态JSON | EN |

## 理由

### 为什么混合策略
- **实时源**展示工程能力(API/RSS 抓取、代理管理、错误降级)
- **静态源**保证可复现(GitHub Trending 非官方 API 不稳定)
- 题目要求"中英文混合",需要中英社区+媒体均衡

### 为什么选这些源(竞品调研 + 实测)
1. **论文选 HuggingFace 而非 arXiv**:HF Daily Papers 是人工+社区策展的每日精选(~10 篇),契合"日报"定位;arXiv 原始流每天上百篇,信息密度低,需自己做第二层筛选,对 MVP 冗余
2. **社区选 Dev.to 而非 Reddit**:Reddit 未认证请求被 policy block,需 OAuth;Dev.to 免 key、AI 标签直接可用、字段最丰富(cover_image/reactions/tags)
3. **中文社区选知乎热榜**:知乎热榜 API 实测可用,字段含热度(detail_text)和回答数,关键词过滤 AI 问题即可
4. **中文媒体选 36氪**:机器之心反爬拦截页、量子位 403、RSSHub 公共实例官方限制;36氪 RSS 实测可用,最新 2026-07-12 文章
5. **英文媒体选 TechCrunch**:偏创投产业,与 36氪中英对照;The Verge 偏消费科技,舆情分析价值低

### 为什么不选其他源
- ❌ Twitter/X:API 付费($100/月起)
- ❌ Reddit:未认证被 block,需 OAuth
- ❌ Quora:Cloudflare 挑战页
- ❌ Product Hunt:需 OAuth2
- ❌ Semantic Scholar:429 限流
- ❌ 机器之心/量子位:反爬严

## 后果
- **优点**:6 实时源保证数据新鲜度,1 静态源保证可复现,中英社区+媒体均衡
- **缺点**:依赖代理(HuggingFace/TechCrunch),如果代理不可用需要降级
- **风险**:知乎热榜 API 非官方,未来可能限制访问;已有缓存降级机制
