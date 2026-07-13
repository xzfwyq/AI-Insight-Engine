#!/usr/bin/env node
// @ts-check
/**
 * Pipeline 入口脚本
 * 用法:
 *   node scripts/run-pipeline.mjs              # 完整流水线
 *   node scripts/run-pipeline.mjs --only-fetch # 只抓取不抽取(调试)
 *   node scripts/run-pipeline.mjs --sources hn,devto  # 指定数据源
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 必须在 import runner 之前加载 .env,否则 extractor/aggregator 顶层代码会读到 undefined
config({ path: resolve(__dirname, '..', '.env') });

const { runPipeline } = await import('../src/pipeline/runner.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { onlyFetch: false, sources: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only-fetch') {
      options.onlyFetch = true;
    } else if (args[i] === '--sources' && args[i + 1]) {
      options.sources = args[i + 1].split(',').map((s) => s.trim());
      i++;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();

  if (!options.onlyFetch && !process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 未设置 ANTHROPIC_API_KEY');
    console.error('   请复制 .env.example 为 .env 并填入 API key');
    console.error('   支持原生 Anthropic API 或 Anthropic 兼容协议代理(GLM/Kimi/DeepSeek 等)');
    console.error('   提示: 使用 --only-fetch 可跳过 AI 抽取,仅测试数据采集');
    process.exit(1);
  }
  console.log('🚀 AI Insight Engine Pipeline 启动');
  console.log(`   模式: ${options.onlyFetch ? '仅抓取' : '完整流水线'}`);
  if (options.sources.length > 0) {
    console.log(`   数据源: ${options.sources.join(', ')}`);
  }
  console.log('');

  try {
    await runPipeline(options);
    console.log('\n✅ Pipeline 执行成功');
  } catch (err) {
    console.error('\n❌ Pipeline 执行失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
