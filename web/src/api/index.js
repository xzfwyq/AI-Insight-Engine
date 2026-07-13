/**
 * 数据层 - 加载 Pipeline 产出的结构化 JSON
 *
 * 数据来源:data/processed/*.json
 * - events.json: Map 产出的结构化 Event 数组
 * - aggregated.json: Reduce 产出的聚合分析
 *
 * 路径策略:
 * - 开发模式:Vite dev server 通过 serveDataPlugin 中间件,serve /data/processed/*
 * - 生产模式:构建时把 data/processed/ 复制到 dist/data/,从 ./data/ 加载
 */

const DATA_BASE = './data/processed';

async function fetchJson(path) {
  const res = await fetch(`${DATA_BASE}/${path}`);
  if (!res.ok) {
    throw new Error(`加载 ${path} 失败: HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`加载 ${path} 失败:响应不是有效 JSON(可能文件不存在,返回了 HTML)`);
  }
}

export async function loadEvents() {
  return fetchJson('events.json');
}

export async function loadAggregated() {
  return fetchJson('aggregated.json');
}

export async function loadAll() {
  const [events, aggregated] = await Promise.all([loadEvents(), loadAggregated()]);
  return { events, aggregated };
}
