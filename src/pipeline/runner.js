// @ts-check
/**
 * Pipeline 编排 - 串联 fetch → clean → extract → aggregate → report
 *
 * 职责:
 * 1. 串联各阶段,带耗时统计
 * 2. 错误处理:某阶段失败时降级
 * 3. 中间产物持久化(data/processed/)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAll } from './fetcher.js';
import { cleanAndDedup } from './cleaner.js';
import { extractAll } from './extractor.js';
import { aggregate } from './aggregator.js';
import { generateReport } from '../reporter/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = resolve(__dirname, '..', '..', 'data', 'processed');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function logStep(step, fn) {
  return async (...args) => {
    const start = Date.now();
    console.log(`\n>>> ${step} <<<`);
    const result = await fn(...args);
    console.log(`<<< ${step} 完成,耗时 ${((Date.now() - start) / 1000).toFixed(1)}s >>>\n`);
    return result;
  };
}
// 保留以备未来扩展(如分步日志上报)
void logStep;

/**
 * 运行完整 Pipeline
 * @param {Object} options
 * @param {boolean} options.onlyFetch - 只抓取不抽取(调试用)
 * @param {string[]} options.sources - 指定数据源
 */
export async function runPipeline(options = {}) {
  const { onlyFetch = false, sources = [] } = options;
  const stats = { startedAt: new Date().toISOString(), steps: [] };

  ensureDir(PROCESSED_DIR);

  // Step 1: Fetch
  const fetchStart = Date.now();
  const { items: rawItems, errors: fetchErrors } = await fetchAll(sources);
  stats.steps.push({ step: 'fetch', duration: (Date.now() - fetchStart) / 1000, errors: fetchErrors });

  if (onlyFetch) {
    writeJson(resolve(PROCESSED_DIR, 'raw-items.json'), rawItems);
    console.log(`\n仅抓取模式:已保存 ${rawItems.length} 条到 data/processed/raw-items.json`);
    return { rawItems, stats };
  }

  // Step 2: Clean
  const cleanStart = Date.now();
  const cleaned = cleanAndDedup(rawItems);
  stats.steps.push({ step: 'clean', duration: (Date.now() - cleanStart) / 1000, input: rawItems.length, output: cleaned.length });
  writeJson(resolve(PROCESSED_DIR, 'cleaned-items.json'), cleaned);

  if (cleaned.length === 0) {
    console.error('清洗后无数据,终止 Pipeline');
    return { cleaned, stats };
  }

  // Step 3: Extract (Map)
  const extractStart = Date.now();
  const { events, failures, stats: extractStats } = await extractAll(cleaned);
  stats.steps.push({ step: 'extract', duration: (Date.now() - extractStart) / 1000, ...extractStats });
  writeJson(resolve(PROCESSED_DIR, 'events.json'), events);
  if (failures.length > 0) {
    writeJson(resolve(PROCESSED_DIR, 'extract-failures.json'), failures);
  }

  if (events.length === 0) {
    console.error('抽取无成功结果,终止 Pipeline');
    return { events, stats };
  }

  // Step 4: Aggregate (Reduce)
  const aggStart = Date.now();
  const aggregated = await aggregate(events);
  stats.steps.push({ step: 'aggregate', duration: (Date.now() - aggStart) / 1000 });

  // 用带 heatScore 的 enrichedEvents 覆盖 events.json(前端需要热度分)
  const enrichedEvents = aggregated.enrichedEvents || events;
  writeJson(resolve(PROCESSED_DIR, 'events.json'), enrichedEvents);
  writeJson(resolve(PROCESSED_DIR, 'aggregated.json'), aggregated);

  // Step 5: Report
  const reportStart = Date.now();
  const report = generateReport(events, aggregated);
  writeFileSync(resolve(PROCESSED_DIR, 'report.md'), report);
  stats.steps.push({ step: 'report', duration: (Date.now() - reportStart) / 1000 });

  stats.finishedAt = new Date().toISOString();
  stats.totalDuration = (new Date(stats.finishedAt) - new Date(stats.startedAt)) / 1000;

  writeJson(resolve(PROCESSED_DIR, 'pipeline-stats.json'), stats);

  console.log('\n=== Pipeline 完成 ===');
  console.log(`总耗时: ${stats.totalDuration.toFixed(1)}s`);
  console.log(`产出:`);
  console.log(`  - data/processed/events.json (${events.length} 个 Event)`);
  console.log(`  - data/processed/aggregated.json (聚合分析)`);
  console.log(`  - data/processed/report.md (日报)`);

  return { events, aggregated, report, stats };
}

export default runPipeline;
