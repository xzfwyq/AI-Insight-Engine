// @ts-check
/**
 * 数据清洗层 - 去重 / 标准化 / 语言检测
 *
 * 职责:
 * 1. 标题去重(同一新闻可能被多个源报道)
 * 2. URL 去重
 * 3. 字段标准化(时间格式、字符串 trim)
 * 4. 简单语言检测(中文字符占比 > 30% 判定为 zh)
 * 5. 生成稳定 id(用于去重和关联)
 */

import { createHash } from 'node:crypto';

/**
 * 简单语言检测:中文字符占比
 * @param {string} text
 * @returns {'zh' | 'en'}
 */
function detectLanguage(text) {
  if (!text) return 'en';
  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const ratio = chineseChars / text.length;
  return ratio > 0.15 ? 'zh' : 'en';
}

/**
 * 生成稳定 id
 */
function generateId(sourceType, url, title) {
  const input = `${sourceType}:${url || title}`;
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/**
 * 标题相似度判断(简单 Jaccard,用于跨源去重)
 */
function isSimilarTitle(a, b) {
  if (!a || !b) return false;
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9一-龥]/g, ' ').split(/\s+/).filter(Boolean);
  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));
  if (setA.size === 0 || setB.size === 0) return false;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union > 0.7;
}

/**
 * 清洗单条
 */
function cleanItem(item) {
  const title = (item.title || '').trim();
  const summary = (item.summary || '').trim().slice(0, 500);
  const url = (item.url || '').trim();
  const publishedAt = normalizeDate(item.publishedAt);
  const language = item.language || detectLanguage(title + ' ' + summary);

  return {
    id: generateId(item.sourceType, url, title),
    title,
    summary,
    url,
    publishedAt,
    language,
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    rawContent: (item.rawContent || '').slice(0, 2000),
    rawContentType: item.rawContentType,
    metadata: item.metadata || {},
  };
}

/**
 * 日期标准化为 ISO 8601
 */
function normalizeDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * 清洗 + 去重
 * @param {Array} rawItems
 * @returns {Array} cleaned items
 */
export function cleanAndDedup(rawItems) {
  console.log('=== 数据清洗 ===');
  console.log(`输入: ${rawItems.length} 条`);

  const cleaned = rawItems.map(cleanItem);
  console.log(`清洗后: ${cleaned.length} 条`);

  // 去重:按 id
  const seen = new Map();
  for (const item of cleaned) {
    if (!seen.has(item.id)) {
      seen.set(item.id, item);
    }
  }
  const unique = Array.from(seen.values());
  console.log(`按 id 去重后: ${unique.length} 条`);

  // 跨源去重:相似标题
  const result = [];
  for (const item of unique) {
    const duplicate = result.find((r) => isSimilarTitle(r.title, item.title));
    if (duplicate) {
      console.log(`  跨源重复: "${item.title}" ~ "${duplicate.title}"`);
      continue;
    }
    result.push(item);
  }
  console.log(`跨源去重后: ${result.length} 条\n`);

  return result;
}

export { detectLanguage, generateId };
