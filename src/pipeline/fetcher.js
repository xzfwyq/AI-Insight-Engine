// @ts-check
/**
 * 数据采集层 - 6 实时源抓取 + 1 静态源加载
 *
 * 设计要点:
 * 1. 每个源独立 fetcher 函数,失败不影响其他源(降级处理)
 * 2. 需要代理的源(HuggingFace/TechCrunch)走 ProxyAgent,国内源直连
 * 3. 统一返回 RawItem 格式,字段标准化,便于 cleaner 处理
 * 4. 每个源带缓存机制:抓取失败时降级到上次缓存
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import { ProxyAgent } from 'undici';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const DATA_RAW_DIR = resolve(PROJECT_ROOT, 'data', 'raw');

const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890';

const rssParser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'ai-insight-engine/0.1' },
});

/**
 * 带代理的 fetch(HuggingFace/TechCrunch 用)
 */
async function fetchWithProxy(url, options = {}) {
  const dispatcher = new ProxyAgent(PROXY_URL);
  return fetch(url, { ...options, dispatcher });
}

/**
 * 缓存抓取结果,失败时降级
 */
function cachePath(sourceId) {
  return resolve(DATA_RAW_DIR, `${sourceId}.cache.json`);
}

function saveCache(sourceId, data) {
  const path = cachePath(sourceId);
  writeFileSync(path, JSON.stringify({ cachedAt: new Date().toISOString(), data }, null, 2));
}

function loadCache(sourceId) {
  const path = cachePath(sourceId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 统一的 RawItem 格式
 * @typedef {Object} RawItem
 * @property {string} sourceId - 数据源 ID
 * @property {string} sourceType - 数据源类型(对应 Schema source.type)
 * @property {string} title
 * @property {string} summary
 * @property {string} url
 * @property {string} publishedAt - ISO 8601
 * @property {string} language - 'zh' | 'en'
 * @property {string} rawContent - 原始内容
 * @property {string} rawContentType - 'abstract'|'discussion'|'article'|'readme'|'news'
 * @property {Object} metadata - 数据源特有元数据
 */

// ========== 1. HuggingFace Daily Papers ==========
async function fetchHfPapers() {
  const url = 'https://huggingface.co/api/daily_papers';
  console.log('  [hf_papers] 抓取 HuggingFace Daily Papers...');
  const res = await fetchWithProxy(url);
  if (!res.ok) throw new Error(`HF papers API ${res.status}`);
  const papers = await res.json();
  const items = papers.slice(0, 5).map((p) => ({
    sourceId: 'hf_papers',
    sourceType: 'hf_papers',
    title: p.paper.title,
    summary: (p.paper.summary || '').slice(0, 500),
    url: `https://huggingface.co/papers/${p.paper.id}`,
    publishedAt: p.paper.publishedAt || new Date().toISOString(),
    language: 'en',
    rawContent: p.paper.summary,
    rawContentType: 'abstract',
    metadata: {
      authors: (p.paper.authors || []).slice(0, 5).map((a) => a.name),
      paperId: p.paper.id,
    },
  }));
  console.log(`  [hf_papers] 抓到 ${items.length} 篇论文`);
  return items;
}

// ========== 2. TechCrunch AI ==========
async function fetchTechCrunch() {
  const url = 'https://techcrunch.com/category/artificial-intelligence/feed/';
  console.log('  [techcrunch] 抓取 TechCrunch AI RSS...');
  const res = await fetchWithProxy(url);
  if (!res.ok) throw new Error(`TechCrunch RSS ${res.status}`);
  const xml = await res.text();
  const feed = await rssParser.parseString(xml);
  const items = (feed.items || []).slice(0, 4).map((item) => ({
    sourceId: 'techcrunch',
    sourceType: 'techcrunch',
    title: item.title,
    summary: (item.contentSnippet || item.content || '').slice(0, 500),
    url: item.link,
    publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
    language: 'en',
    rawContent: item.content || item.contentSnippet,
    rawContentType: 'article',
    metadata: {
      author: item.creator || item.author,
      category: 'AI',
    },
  }));
  console.log(`  [techcrunch] 抓到 ${items.length} 篇文章`);
  return items;
}

// ========== 3. 36氪 ==========
async function fetch36kr() {
  const url = 'https://36kr.com/feed';
  console.log('  [36kr] 抓取 36氪 RSS...');
  const res = await fetch(url, { headers: { 'User-Agent': 'ai-insight-engine/0.1' } });
  if (!res.ok) throw new Error(`36kr RSS ${res.status}`);
  const xml = await res.text();
  const feed = await rssParser.parseString(xml);
  const aiKeywords = /AI|人工智能|大模型|LLM|GPT|Claude|机器学习|深度学习|生成式|Gemini|ChatGPT/i;
  const items = (feed.items || [])
    .filter((item) => aiKeywords.test(item.title) || aiKeywords.test(item.contentSnippet || ''))
    .slice(0, 4)
    .map((item) => ({
      sourceId: '36kr',
      sourceType: '36kr',
      title: item.title,
      summary: (item.contentSnippet || item.content || '').replace(/<[^>]+>/g, '').slice(0, 500),
      url: item.link,
      publishedAt: item.isoDate || new Date().toISOString(),
      language: 'zh',
      rawContent: (item.content || item.contentSnippet || '').replace(/<[^>]+>/g, ''),
      rawContentType: 'news',
      metadata: {
        category: 'AI',
      },
    }));
  console.log(`  [36kr] 抓到 ${items.length} 篇 AI 相关文章`);
  return items;
}

// ========== 4. 知乎热榜 ==========
async function fetchZhihu() {
  const url = 'https://api.zhihu.com/topstory/hot-list?limit=50';
  console.log('  [zhihu] 抓取知乎热榜...');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (ai-insight-engine/0.1)' },
  });
  if (!res.ok) throw new Error(`知乎 API ${res.status}`);
  const json = await res.json();
  const aiKeywords = /AI|人工智能|大模型|LLM|GPT|Claude|机器学习|深度学习|神经网络|生成式|Gemini|ChatGPT|OpenAI|Anthropic/i;
  const items = (json.data || [])
    .filter((item) => aiKeywords.test(item.target.title) || aiKeywords.test(item.target.excerpt || ''))
    .slice(0, 3)
    .map((item) => ({
      sourceId: 'zhihu',
      sourceType: 'zhihu',
      title: item.target.title,
      summary: (item.target.excerpt || '').slice(0, 300),
      url: `https://www.zhihu.com/question/${item.target.id}`,
      publishedAt: new Date(item.target.created * 1000).toISOString(),
      language: 'zh',
      rawContent: item.target.excerpt,
      rawContentType: 'news',
      metadata: {
        heat: item.detail_text,
        answerCount: item.target.answer_count,
      },
    }));
  console.log(`  [zhihu] 抓到 ${items.length} 条 AI 相关热榜`);
  return items;
}

// ========== 5. Dev.to ==========
async function fetchDevto() {
  const url = 'https://dev.to/api/articles?tag=ai&per_page=10';
  console.log('  [devto] 抓取 Dev.to AI 文章...');
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Dev.to API ${res.status}`);
  const articles = await res.json();
  const items = articles.slice(0, 3).map((a) => ({
    sourceId: 'devto',
    sourceType: 'devto',
    title: a.title,
    summary: (a.description || '').slice(0, 300),
    url: a.url,
    publishedAt: a.published_timestamp || new Date().toISOString(),
    language: 'en',
    rawContent: a.description,
    rawContentType: 'article',
    metadata: {
      reactionsCount: a.public_reactions_count,
      tags: a.tag_list || [],
      coverImage: a.cover_image,
    },
  }));
  console.log(`  [devto] 抓到 ${items.length} 篇文章`);
  return items;
}

// ========== 6. Hacker News (Algolia) ==========
async function fetchHN() {
  const url = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI&hitsPerPage=15';
  console.log('  [hn] 抓取 Hacker News...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN Algolia API ${res.status}`);
  const json = await res.json();
  const items = (json.hits || [])
    .filter((hit) => hit.points >= 30 && hit.title)
    .slice(0, 3)
    .map((hit) => ({
      sourceId: 'hn',
      sourceType: 'hn',
      title: hit.title,
      summary: (hit.story_text || '').replace(/<[^>]+>/g, '').slice(0, 500) || hit.title,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      publishedAt: hit.created_at,
      language: 'en',
      rawContent: hit.story_text || hit.title,
      rawContentType: 'discussion',
      metadata: {
        score: hit.points,
        commentsCount: hit.num_comments || 0,
      },
    }));
  console.log(`  [hn] 抓到 ${items.length} 条讨论(score>=30)`);
  return items;
}

// ========== 7. GitHub Trending (静态) ==========
function loadGithubStatic() {
  const path = resolve(DATA_RAW_DIR, 'github.json');
  console.log('  [github] 加载静态 GitHub Trending 数据...');
  if (!existsSync(path)) {
    console.warn('  [github] 静态数据不存在,跳过');
    return [];
  }
  const repos = JSON.parse(readFileSync(path, 'utf-8'));
  const items = repos.map((r) => ({
    sourceId: 'github',
    sourceType: 'github',
    title: `${r.repo}: ${r.description || ''}`,
    summary: r.description || r.repo,
    url: r.url,
    publishedAt: r.publishedAt || new Date().toISOString(),
    language: 'en',
    rawContent: `${r.repo}\n${r.description || ''}\nStars: ${r.stars} Forks: ${r.forks} Language: ${r.language || 'N/A'}`,
    rawContentType: 'readme',
    metadata: {
      stars: r.stars,
      forks: r.forks,
      repoLanguage: r.language,
    },
  }));
  console.log(`  [github] 加载 ${items.length} 个仓库`);
  return items;
}

// ========== 统一调度 ==========
const FETCHERS = {
  hf_papers: { fn: fetchHfPapers, critical: true },
  techcrunch: { fn: fetchTechCrunch, critical: false },
  '36kr': { fn: fetch36kr, critical: true },
  zhihu: { fn: fetchZhihu, critical: true },
  devto: { fn: fetchDevto, critical: false },
  hn: { fn: fetchHN, critical: true },
  github: { fn: loadGithubStatic, critical: false },
};

/**
 * 抓取所有数据源
 * @param {string[]} only - 只抓取指定源(用于 --only-fetch 或调试)
 * @returns {Promise<RawItem[]>}
 */
export async function fetchAll(only = []) {
  console.log('\n=== 开始数据采集 ===');
  const entries = Object.entries(FETCHERS).filter(([id]) => only.length === 0 || only.includes(id));
  const allItems = [];
  const errors = [];

  for (const [id, { fn, critical }] of entries) {
    try {
      const items = await fn();
      allItems.push(...items);
      saveCache(id, items);
    } catch (err) {
      console.error(`  [${id}] 抓取失败: ${err.message}`);
      errors.push({ source: id, error: err.message });
      // 降级:尝试加载缓存
      const cache = loadCache(id);
      if (cache && cache.data) {
        console.log(`  [${id}] 降级使用缓存(${cache.cachedAt})`);
        allItems.push(...cache.data);
      } else if (critical) {
        console.error(`  [${id}] 关键源失败且无缓存!`);
      }
    }
  }

  console.log(`\n=== 数据采集完成:共 ${allItems.length} 条 ===\n`);
  return { items: allItems, errors };
}

export { loadGithubStatic };
