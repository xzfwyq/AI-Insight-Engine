// @ts-check
/**
 * Event Schema - AI 舆情分析日报系统的核心数据模型
 *
 * 设计思路(响应题目"鼓励根据数据源特点调整 schema"):
 * 维度1: source.metadata 用可选字段兼容 7 种数据源特有元数据
 * 维度2: entities.type 扩展到 12 种,覆盖学术和开源实体
 * 维度3: rawContentType 标注原始内容形态,指导下游分析策略
 */

import { z } from 'zod';

export const SourceTypeSchema = z.enum([
  'hf_papers',      // HuggingFace Daily Papers(学术)
  'hn',             // Hacker News(聚合平台)
  'devto',          // Dev.to(开发者社区)
  'techcrunch',     // TechCrunch(英文媒体)
  '36kr',           // 36氪(中文媒体)
  'zhihu',          // 知乎热榜(中文社区)
  'github',         // GitHub Trending(开源)
]);

export const EntityTypeSchema = z.enum([
  // 通用
  'company', 'product', 'technology', 'person', 'organization',
  // 学术源特有
  'paper', 'dataset', 'method', 'benchmark',
  // 开源源特有
  'repository', 'framework', 'language',
]);

export const RawContentTypeSchema = z.enum([
  'abstract',     // hf_papers 论文摘要
  'discussion',   // hn 讨论帖
  'article',      // devto/techcrunch 文章
  'readme',       // github README
  'news',         // 36kr/zhihu 新闻/热榜
]);

export const EventSchema = z.object({
  id: z.string().describe('事件唯一标识,用 source type + 原始 id 哈希'),
  title: z.string().max(200).describe('事件标题'),
  summary: z.string().max(400).describe('事件摘要,150-250 字,硬上限 400 字'),
  publishedAt: z.string().datetime().describe('发布时间 ISO 8601'),
  language: z.enum(['zh', 'en']).describe('语言'),

  source: z.object({
    name: z.string().describe('数据源名称'),
    url: z.string().url().describe('原始链接'),
    type: SourceTypeSchema,
    metadata: z.object({
      // 学术源(hf_papers)
      authors: z.array(z.string()).optional(),
      paperId: z.string().optional(),
      // 社区源(hn)
      score: z.number().optional(),
      commentsCount: z.number().optional(),
      // 开发者源(devto)
      reactionsCount: z.number().optional(),
      tags: z.array(z.string()).optional(),
      coverImage: z.string().optional(),
      // 开源源(github)
      stars: z.number().optional(),
      forks: z.number().optional(),
      repoLanguage: z.string().optional(),
      // 媒体源(techcrunch/36kr)
      author: z.string().optional(),
      category: z.string().optional(),
      // 知乎热榜
      heat: z.string().optional(),
      answerCount: z.number().optional(),
    }),
  }),

  entities: z.array(z.object({
    name: z.string(),
    type: EntityTypeSchema,
    role: z.enum(['subject', 'object', 'beneficiary', 'context']).optional(),
  })).min(1).describe('至少抽取 1 个实体'),

  topics: z.array(z.object({
    name: z.string(),
    confidence: z.number().min(0).max(1),
  })).min(1).describe('至少 1 个主题标签'),

  sentiment: z.object({
    direction: z.enum(['positive', 'negative', 'neutral']),
    score: z.number().min(-1).max(1),
    // 词典法附加字段(可选,Map 阶段 AI 不填,Reduce 阶段词典覆盖时填)
    method: z.string().optional(),
    posHits: z.array(z.string()).optional(),
    negHits: z.array(z.string()).optional(),
  }),

  // 词典法覆盖后,保留原 AI 判断作为对比参考
  originalSentiment: z.object({
    direction: z.enum(['positive', 'negative', 'neutral']),
    score: z.number().min(-1).max(1),
  }).optional(),

  impact: z.object({
    scope: z.enum(['industry', 'company', 'research', 'consumer']).optional(),
    timeHorizon: z.enum(['immediate', 'short-term', 'long-term']).optional(),
    affectedEntities: z.array(z.string()).optional(),
  }).optional().describe('影响评估,无明确影响信息时省略'),

  rawContent: z.string().optional().describe('原始内容(摘要/正文/讨论)'),
  rawContentType: RawContentTypeSchema.optional(),
});

export const AggregatedReportSchema = z.object({
  generatedAt: z.string().datetime(),
  totalEvents: z.number(),
  languageDistribution: z.object({
    zh: z.number(),
    en: z.number(),
  }),
  topEntities: z.array(z.object({
    name: z.string(),
    type: EntityTypeSchema,
    count: z.number(),
  })),
  topicDistribution: z.array(z.object({
    name: z.string(),
    count: z.number(),
  })),
  sentimentOverview: z.object({
    positive: z.number(),
    negative: z.number(),
    neutral: z.number(),
    avgScore: z.number(),
  }),
  topEvents: z.array(z.object({
    id: z.string(),
    title: z.string(),
    significance: z.number().min(0).max(1),
    reason: z.string(),
  })),
  trendAnalysis: z.string().describe('趋势分析自然语言段落'),
  riskOpportunity: z.string().optional().describe('风险/机会提示'),
});

/**
 * AI 总结子集 Schema(只校验 AI 负责的字段)
 *
 * 拆分动机:AggregatedReportSchema 包含 generatedAt/totalEvents/topEntities 等统计字段,
 * 这些由代码计算,不是 AI 生成。用完整 schema 校验 AI 输出会因缺少统计字段而失败。
 * 拆出 AiSummarySchema 只校验 AI 负责的字段,统计字段由 aggregate 函数合并。
 *
 * v2 重构(对标 TLDR/36氪早报/CB Insights):
 * - headline + keyPoints 替代"取 trendAnalysis 第一句"(原来切掉了最有价值信息)
 * - trends 分栏 bullet 替代 300 字大段文字(原来违反扫读优先)
 * - risks/opportunities 分离数组替代"风险:xxx 机会:yyy"一段话(原来决策动作混在一起)
 */
export const AiSummarySchema = z.object({
  topEvents: z.array(z.object({
    id: z.string(),
    title: z.string(),
    significance: z.number().min(0).max(1),
    reason: z.string(),
  })),
  headline: z.string().min(10).max(80).describe('一句话总结'),
  keyPoints: z.array(z.object({
    text: z.string(),
    eventId: z.string(),
  })).min(1).max(5),
  trends: z.array(z.object({
    dimension: z.enum(['技术', '应用', '竞争', '资本', '政策']),
    bullets: z.array(z.object({
      text: z.string(),
      eventId: z.string().optional(),
    })),
  })),
  risks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    eventId: z.string().optional(),
  })),
  opportunities: z.array(z.object({
    title: z.string(),
    description: z.string(),
    eventId: z.string().optional(),
  })),
  // 保留旧字段用于 markdown 报告向后兼容(markdown.js 仍用 trendAnalysis/riskOpportunity)
  trendAnalysis: z.string().optional(),
  riskOpportunity: z.string().optional(),
});

export default EventSchema;
