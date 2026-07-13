// @ts-check
/**
 * 报告生成器 - 基于结构化数据生成 Markdown 日报
 *
 * 报告结构:
 * 1. 元信息(生成时间、数据量)
 * 2. 今日热点 Top5(来自 AI 总结)
 * 3. 重要事件深度总结(每个 topEvent 的详情)
 * 4. 趋势判断(AI 生成)
 * 5. 风险与机会(AI 生成)
 * 6. 数据统计(实体/主题/情感/语言分布)
 * 7. 完整事件列表(表格)
 */

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  } catch {
    return iso;
  }
}

/**
 * 生成 Markdown 报告
 */
export function generateReport(events, aggregated) {
  const lines = [];
  const reportDate = new Date(aggregated.generatedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });

  lines.push(`# AI 舆情分析日报 - ${reportDate}`);
  lines.push('');
  lines.push(`> 生成时间: ${formatDate(aggregated.generatedAt)} | 数据源: 7 个 | 事件总数: ${aggregated.totalEvents} | 中英混合: zh=${aggregated.languageDistribution.zh} en=${aggregated.languageDistribution.en}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 1. 今日热点
  lines.push('## 一、今日 AI 领域主要热点');
  lines.push('');
  if (aggregated.topEvents && aggregated.topEvents.length > 0) {
    aggregated.topEvents.forEach((ev, i) => {
      lines.push(`### ${i + 1}. ${ev.title}`);
      lines.push('');
      lines.push(`**重要性**: ${'★'.repeat(Math.round(ev.significance * 5))} (${ev.significance.toFixed(2)})`);
      lines.push('');
      lines.push(`**入选理由**: ${ev.reason}`);
      lines.push('');
      const fullEvent = events.find((e) => e.id === ev.id);
      if (fullEvent) {
        lines.push(`**摘要**: ${fullEvent.summary}`);
        lines.push('');
        if (fullEvent.source?.url) {
          lines.push(`**来源**: [${fullEvent.source.name}](${fullEvent.source.url})`);
          lines.push('');
        }
      }
      lines.push('---');
      lines.push('');
    });
  } else {
    lines.push('暂无热点事件。');
    lines.push('');
  }

  // 2. 趋势判断
  lines.push('## 二、趋势判断');
  lines.push('');
  lines.push(aggregated.trendAnalysis || '暂无趋势分析。');
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3. 风险与机会
  if (aggregated.riskOpportunity) {
    lines.push('## 三、风险与机会提示');
    lines.push('');
    lines.push(aggregated.riskOpportunity);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 4. 数据统计
  lines.push('## 四、数据统计');
  lines.push('');

  // 实体频次
  lines.push('### 关键实体 Top10');
  lines.push('');
  lines.push('| 实体 | 类型 | 出现次数 |');
  lines.push('|---|---|---|');
  aggregated.topEntities.slice(0, 10).forEach((e) => {
    lines.push(`| ${e.name} | ${e.type} | ${e.count} |`);
  });
  lines.push('');

  // 主题分布
  lines.push('### 主题分布');
  lines.push('');
  lines.push('| 主题 | 出现次数 |');
  lines.push('|---|---|');
  aggregated.topicDistribution.slice(0, 10).forEach((t) => {
    lines.push(`| ${t.name} | ${t.count} |`);
  });
  lines.push('');

  // 情感概览
  lines.push('### 情感分布');
  lines.push('');
  const s = aggregated.sentimentOverview;
  lines.push(`- 正面: ${s.positive} 条`);
  lines.push(`- 负面: ${s.negative} 条`);
  lines.push(`- 中性: ${s.neutral} 条`);
  lines.push(`- 平均情感分: ${s.avgScore.toFixed(3)} (范围 -1 到 1)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 5. 完整事件列表
  lines.push('## 五、完整事件列表');
  lines.push('');
  lines.push('| # | 标题 | 数据源 | 语言 | 情感 | 发布时间 |');
  lines.push('|---|---|---|---|---|---|');
  events.forEach((ev, i) => {
    const title = ev.title.replace(/\|/g, '\\|').slice(0, 60);
    const source = ev.source?.type || '';
    const sentiment = `${ev.sentiment?.direction}(${ev.sentiment?.score?.toFixed(2) || 0})`;
    const time = formatDate(ev.publishedAt).split(' ')[0];
    lines.push(`| ${i + 1} | ${title} | ${source} | ${ev.language} | ${sentiment} | ${time} |`);
  });
  lines.push('');

  // 6. 元信息
  lines.push('---');
  lines.push('');
  lines.push('## 关于本报告');
  lines.push('');
  lines.push('本报告由 **AI Insight Engine** 自动生成,采用 Map-Reduce Pipeline 架构:');
  lines.push('');
  lines.push('1. **数据采集**:6 实时源(HuggingFace/TechCrunch/36氪/知乎/Dev.to/HN)+ 1 静态源(GitHub Trending)');
  lines.push('2. **Map 抽取**:每条新闻独立调用 Claude,用 Tool Use 强制 Schema,Zod 运行时校验 + 失败重试');
  lines.push('3. **Reduce 聚合**:基于结构化 Event 做实体/主题/情感统计 + AI 生成趋势分析');
  lines.push('4. **报告生成**:结构化数据渲染为 Markdown');
  lines.push('');
  lines.push('> 本系统不将原始数据一次性丢给 AI,而是先结构化再分析,保证可复现、可校验、可解释。');
  lines.push('');

  return lines.join('\n');
}

export default generateReport;
