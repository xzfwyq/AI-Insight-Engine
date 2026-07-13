#!/usr/bin/env node
// @ts-check
/**
 * 只跑 Reduce 阶段(复用已有 events.json,调试用)
 * 用法: node scripts/run-aggregate-only.mjs
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const { aggregate } = await import('../src/pipeline/aggregator.js');
import { generateReport } from '../src/reporter/markdown.js';

const PROCESSED_DIR = resolve(__dirname, '..', 'data', 'processed');

async function main() {
  console.log('📊 只跑 Reduce 阶段(复用 events.json)\n');

  const eventsPath = resolve(PROCESSED_DIR, 'events.json');
  const events = JSON.parse(readFileSync(eventsPath, 'utf-8'));
  console.log(`加载 ${events.length} 个 Event\n`);

  const aggregated = await aggregate(events);

  writeFileSync(resolve(PROCESSED_DIR, 'aggregated.json'), JSON.stringify(aggregated, null, 2));

  const report = generateReport(events, aggregated);
  writeFileSync(resolve(PROCESSED_DIR, 'report.md'), report);

  console.log('\n✅ Reduce 完成,产出:');
  console.log('  - data/processed/aggregated.json');
  console.log('  - data/processed/report.md');
}

main().catch((err) => {
  console.error('\n❌ 失败:', err.message);
  process.exit(1);
});
