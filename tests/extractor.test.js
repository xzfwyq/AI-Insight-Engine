import { describe, it, expect } from 'vitest';
import { EventSchema, AggregatedReportSchema } from '../src/schema/event.js';
import { cleanAndDedup, detectLanguage, generateId } from '../src/pipeline/cleaner.js';

describe('EventSchema', () => {
  const validEvent = {
    id: 'test123',
    title: 'OpenAI 发布 GPT-5',
    summary: 'OpenAI 发布最新大模型 GPT-5,在多模态推理上显著提升',
    publishedAt: '2026-07-12T10:00:00.000Z',
    language: 'zh',
    source: {
      name: '36氪',
      url: 'https://36kr.com/p/123',
      type: '36kr',
      metadata: { author: '36氪编辑部', category: 'AI' },
    },
    entities: [
      { name: 'OpenAI', type: 'company', role: 'subject' },
      { name: 'GPT-5', type: 'product', role: 'object' },
    ],
    topics: [{ name: 'LLM', confidence: 0.95 }],
    sentiment: { direction: 'positive', score: 0.6 },
    impact: { scope: 'industry', timeHorizon: 'short-term' },
    rawContent: '...',
    rawContentType: 'news',
  };

  it('校验通过:完整的 Event', () => {
    const result = EventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('校验失败:缺少必填字段', () => {
    const invalid = { ...validEvent };
    delete invalid.title;
    const result = EventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('校验失败:entities 为空数组', () => {
    const invalid = { ...validEvent, entities: [] };
    const result = EventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('校验通过:可选字段可省略', () => {
    const minimal = {
      id: 'min',
      title: 'Test',
      summary: 'Test summary',
      publishedAt: '2026-07-12T10:00:00.000Z',
      language: 'en',
      source: { name: 'Test', url: 'https://test.com', type: 'hn', metadata: {} },
      entities: [{ name: 'Test', type: 'technology' }],
      topics: [{ name: 'test', confidence: 0.5 }],
      sentiment: { direction: 'neutral', score: 0 },
    };
    const result = EventSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('校验失败:非法的 source.type', () => {
    const invalid = { ...validEvent, source: { ...validEvent.source, type: 'invalid_type' } };
    const result = EventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('校验失败:非法的 entity.type', () => {
    const invalid = {
      ...validEvent,
      entities: [{ name: 'X', type: 'invalid_entity' }],
    };
    const result = EventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('中文文本判定为 zh', () => {
    expect(detectLanguage('这是一段中文文本,包含大量汉字')).toBe('zh');
  });

  it('英文文本判定为 en', () => {
    expect(detectLanguage('This is an English text')).toBe('en');
  });

  it('空文本默认 en', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('混合文本按占比判定', () => {
    // 'AI 大模型 LLM GPT' 中文占比 21%(3/14),判定为 zh 合理
    expect(detectLanguage('AI 大模型 LLM GPT')).toBe('zh');
    expect(detectLanguage('人工智能大模型是未来方向')).toBe('zh');
    expect(detectLanguage('OpenAI releases GPT-5 with multimodal')).toBe('en');
  });
});

describe('generateId', () => {
  it('相同输入生成相同 id', () => {
    const id1 = generateId('hn', 'https://example.com/1', 'title');
    const id2 = generateId('hn', 'https://example.com/1', 'title');
    expect(id1).toBe(id2);
  });

  it('不同输入生成不同 id', () => {
    const id1 = generateId('hn', 'https://example.com/1', 'title');
    const id2 = generateId('hn', 'https://example.com/2', 'title');
    expect(id1).not.toBe(id2);
  });

  it('id 长度为 16', () => {
    const id = generateId('hn', 'url', 'title');
    expect(id.length).toBe(16);
  });
});

describe('cleanAndDedup', () => {
  it('按 id 去重', () => {
    const items = [
      {
        sourceId: 'hn',
        sourceType: 'hn',
        title: 'Test 1',
        summary: 'Summary 1',
        url: 'https://example.com/1',
        publishedAt: '2026-07-12T10:00:00Z',
        language: 'en',
        rawContent: 'content',
        rawContentType: 'discussion',
        metadata: {},
      },
      {
        sourceId: 'hn',
        sourceType: 'hn',
        title: 'Test 1 Duplicate',
        summary: 'Summary 1',
        url: 'https://example.com/1',
        publishedAt: '2026-07-12T10:00:00Z',
        language: 'en',
        rawContent: 'content',
        rawContentType: 'discussion',
        metadata: {},
      },
    ];
    const result = cleanAndDedup(items);
    expect(result.length).toBe(1);
  });

  it('空数组返回空数组', () => {
    const result = cleanAndDedup([]);
    expect(result.length).toBe(0);
  });
});

describe('AggregatedReportSchema', () => {
  it('校验通过:完整报告', () => {
    const report = {
      generatedAt: '2026-07-12T10:00:00.000Z',
      totalEvents: 20,
      languageDistribution: { zh: 8, en: 12 },
      topEntities: [{ name: 'OpenAI', type: 'company', count: 5 }],
      topicDistribution: [{ name: 'llm', count: 8 }],
      sentimentOverview: { positive: 10, negative: 3, neutral: 7, avgScore: 0.2 },
      topEvents: [{ id: 'abc', title: 'Test', significance: 0.9, reason: '重要' }],
      trendAnalysis: 'AI 趋势向上',
      riskOpportunity: '注意风险',
    };
    const result = AggregatedReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });
});
