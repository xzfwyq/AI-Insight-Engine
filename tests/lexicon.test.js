// @ts-check
import { describe, it, expect } from 'vitest';
import { computeLexiconSentiment, SENTIMENT_LEXICON } from '../src/sentiment/lexicon.js';

describe('computeLexiconSentiment', () => {
  it('空文本返回中性', () => {
    const r = computeLexiconSentiment('');
    expect(r.direction).toBe('neutral');
    expect(r.score).toBe(0);
    expect(r.method).toBe('lexicon');
  });

  it('非字符串返回中性', () => {
    // @ts-ignore 测试容错
    const r = computeLexiconSentiment(null);
    expect(r.direction).toBe('neutral');
  });

  it('正面词命中 → positive', () => {
    const r = computeLexiconSentiment('Anthropic 发布重磅突破,获得业界好评');
    expect(r.direction).toBe('positive');
    expect(r.score).toBeGreaterThan(0);
    expect(r.posHits.length).toBeGreaterThan(0);
    expect(r.posHits.some((h) => h.word === '突破')).toBe(true);
  });

  it('负面词命中 → negative', () => {
    const r = computeLexiconSentiment('全网骂 Claude 变笨,用户吐槽不断');
    expect(r.direction).toBe('negative');
    expect(r.score).toBeLessThan(0);
    expect(r.negHits.some((h) => h.word === '骂')).toBe(true);
    expect(r.negHits.some((h) => h.word === '变笨')).toBe(true);
    expect(r.negHits.some((h) => h.word === '吐槽')).toBe(true);
  });

  it('诉讼类负面词正确识别', () => {
    const r = computeLexiconSentiment('Apple sues OpenAI over alleged trade secret theft');
    expect(r.direction).toBe('negative');
    expect(r.negHits.some((h) => h.word === 'sue' || h.word === 'lawsuit')).toBe(true);
  });

  it('否定词反转极性', () => {
    // "不认可" → 认可是正面,被否定反转成负面
    const r = computeLexiconSentiment('用户不认可这个产品');
    expect(r.negHits.some((h) => h.word === '认可' && h.negated)).toBe(true);
    expect(r.score).toBeLessThan(0);
  });

  it('否定词反转负面为正面', () => {
    // "没有失败" → 失败是负面,被否定反转成正面
    const r = computeLexiconSentiment('这次发布没有失败');
    expect(r.posHits.some((h) => h.word === '失败' && h.negated)).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it('程度副词加权', () => {
    const withoutDegree = computeLexiconSentiment('产品优秀');
    const withDegree = computeLexiconSentiment('产品非常优秀');
    // "非常优秀" 权重 1.5,"优秀" 权重 1
    // 两个都是 1 个正面词,score 都接近 1,但 hits 里 withDegree 的 degree=true
    expect(withDegree.posHits[0].degree).toBe(true);
    expect(withoutDegree.posHits[0].degree).toBe(false);
  });

  it('无情感词返回中性', () => {
    const r = computeLexiconSentiment('这是一个关于 transformer 架构的技术介绍');
    expect(r.direction).toBe('neutral');
    expect(r.posHits.length).toBe(0);
    expect(r.negHits.length).toBe(0);
  });

  it('正负面词数相近时返回中性', () => {
    // 1 正面 + 1 负面,score = 0,neutral
    const r = computeLexiconSentiment('虽然获得融资,但面临诉讼');
    // 融资正面,诉讼负面
    expect(r.posHits.some((h) => h.word === '融资')).toBe(true);
    expect(r.negHits.some((h) => h.word === '诉讼')).toBe(true);
    // score 接近 0(1-1)/max(2,1) = 0
    expect(Math.abs(r.score)).toBeLessThan(0.15);
  });

  it('英文大小写不敏感', () => {
    const r1 = computeLexiconSentiment('BREAKTHROUGH in AI');
    const r2 = computeLexiconSentiment('breakthrough in AI');
    expect(r1.direction).toBe(r2.direction);
    expect(r1.posHits.length).toBe(r2.posHits.length);
  });

  it('可解释性:输出命中词列表', () => {
    const r = computeLexiconSentiment('融资成功,但出现 bug');
    expect(r.posHits.some((h) => h.word === '融资')).toBe(true);
    expect(r.posHits.some((h) => h.word === '成功')).toBe(true);
    expect(r.negHits.some((h) => h.word === 'bug')).toBe(true);
  });

  it('长文本性能不爆炸', () => {
    const longText = '突破 '.repeat(100) + '失败 '.repeat(50);
    const start = Date.now();
    const r = computeLexiconSentiment(longText);
    expect(Date.now() - start).toBeLessThan(100); // < 100ms
    expect(r.direction).toBe('positive'); // 正面词多
  });

  it('原 AI 判断"全网骂 Claude 变笨"判中性的 bug 被修复', () => {
    // 这是原始问题:AI 把"全网骂 Claude 变笨"判中性
    const r = computeLexiconSentiment('全网骂Claude变笨,Anthropic下场揭秘');
    expect(r.direction).toBe('negative');
    expect(r.negHits.some((h) => h.word === '骂')).toBe(true);
    expect(r.negHits.some((h) => h.word === '变笨')).toBe(true);
  });

  it('词典覆盖范围合理', () => {
    // 确保词典不为空,且正负面词数量平衡
    expect(SENTIMENT_LEXICON.positive.length).toBeGreaterThan(50);
    expect(SENTIMENT_LEXICON.negative.length).toBeGreaterThan(50);
    expect(SENTIMENT_LEXICON.negation.length).toBeGreaterThan(5);
    expect(SENTIMENT_LEXICON.degree.length).toBeGreaterThan(5);
  });
});
