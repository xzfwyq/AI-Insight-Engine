<script setup>
import { computed } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ScatterChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, VisualMapComponent, LegendComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { useEventsStore } from '../stores/events';

use([CanvasRenderer, ScatterChart, TooltipComponent, GridComponent, VisualMapComponent, LegendComponent]);

const store = useEventsStore();

const SOURCE_LABELS = {
  hf_papers: 'HF 论文',
  hn: 'HN',
  devto: 'Dev.to',
  techcrunch: 'TechCrunch',
  '36kr': '36氪',
  zhihu: '知乎',
  github: 'GitHub',
};

const SENTIMENT_COLORS = {
  positive: '#52c41a',
  negative: '#ff4d4f',
  neutral: '#8c8c8c',
};

const SENTIMENT_LABELS = {
  positive: '正面',
  negative: '负面',
  neutral: '中性',
};

// 按情感分组散点数据(ECharts 需要每组一个 series 才能图例筛选)
const scatterData = computed(() => {
  const groups = { positive: [], negative: [], neutral: [] };
  const events = store.filteredEvents || [];

  events.forEach((ev) => {
    const dir = ev.sentiment?.direction || 'neutral';
    const heat = ev.heatScore ?? 0;
    const entityCount = (ev.entities || []).length;
    const date = new Date(ev.publishedAt).getTime();
    groups[dir].push({
      value: [date, heat, entityCount, ev],
      itemStyle: {
        color: SENTIMENT_COLORS[dir],
        opacity: store.selectedEvent?.id === ev.id ? 1 : 0.75,
        borderColor: store.selectedEvent?.id === ev.id ? '#ffffff' : 'transparent',
        borderWidth: store.selectedEvent?.id === ev.id ? 2 : 0,
        shadowBlur: store.selectedEvent?.id === ev.id ? 15 : 0,
        shadowColor: SENTIMENT_COLORS[dir],
      },
    });
  });

  return groups;
});

const allEvents = computed(() => store.filteredEvents || []);

const dateRange = computed(() => {
  const times = allEvents.value.map((e) => new Date(e.publishedAt).getTime());
  if (times.length === 0) return { min: Date.now() - 86400000 * 7, max: Date.now() };
  const min = Math.min(...times);
  const max = Math.max(...times);
  // 左右各留 6 小时 padding
  return { min: min - 6 * 3600000, max: max + 6 * 3600000 };
});

const option = computed(() => {
  if (allEvents.value.length === 0) return {};

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const ev = p.data.value[3];
        const d = new Date(ev.publishedAt);
        const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return `<div style="max-width:280px">
          <div style="font-weight:600;margin-bottom:4px">${ev.title.slice(0, 50)}${ev.title.length > 50 ? '...' : ''}</div>
          <div style="color:#8b95a7;font-size:11px">
            ${timeStr} · ${SOURCE_LABELS[ev.source.type] || ev.source.type} · ${ev.language === 'zh' ? '中' : 'EN'}
          </div>
          <div style="margin-top:4px;font-size:11px">
            热度 <b style="color:${SENTIMENT_COLORS[ev.sentiment.direction]}">${ev.heatScore}</b> ·
            情感 <b>${SENTIMENT_LABELS[ev.sentiment.direction]}</b> ·
            实体 ${ev.entities?.length || 0}
          </div>
        </div>`;
      },
    },
    grid: {
      left: 48,
      right: 24,
      top: 16,
      bottom: 56,
    },
    xAxis: {
      type: 'time',
      min: dateRange.value.min,
      max: dateRange.value.max,
      axisLabel: {
        color: '#8b95a7',
        fontSize: 10,
        formatter: (val) => {
          const d = new Date(val);
          return `${d.getMonth() + 1}/${d.getDate()}`;
        },
      },
      splitLine: { lineStyle: { color: 'rgba(140,140,140,0.1)' } },
    },
    yAxis: {
      type: 'value',
      name: '热度',
      nameTextStyle: { color: '#8b95a7', fontSize: 10, padding: [0, 0, 0, -20] },
      min: 0,
      max: 100,
      axisLabel: { color: '#8b95a7', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(140,140,140,0.1)' } },
    },
    legend: {
      data: [
        { name: '正面', itemStyle: { color: SENTIMENT_COLORS.positive } },
        { name: '负面', itemStyle: { color: SENTIMENT_COLORS.negative } },
        { name: '中性', itemStyle: { color: SENTIMENT_COLORS.neutral } },
      ],
      textStyle: { color: '#8b95a7', fontSize: 11 },
      bottom: 8,
      itemWidth: 10,
      itemHeight: 10,
    },
    series: [
      {
        name: '正面',
        type: 'scatter',
        itemStyle: { color: SENTIMENT_COLORS.positive },
        data: scatterData.value.positive,
        symbolSize: (data) => Math.max(10, Math.min(40, data[2] * 3 + 8)),
        emphasis: { focus: 'series', scale: 1.2 },
      },
      {
        name: '负面',
        type: 'scatter',
        itemStyle: { color: SENTIMENT_COLORS.negative },
        data: scatterData.value.negative,
        symbolSize: (data) => Math.max(10, Math.min(40, data[2] * 3 + 8)),
        emphasis: { focus: 'series', scale: 1.2 },
      },
      {
        name: '中性',
        type: 'scatter',
        itemStyle: { color: SENTIMENT_COLORS.neutral },
        data: scatterData.value.neutral,
        symbolSize: (data) => Math.max(10, Math.min(40, data[2] * 3 + 8)),
        emphasis: { focus: 'series', scale: 1.2 },
      },
    ],
  };
});

function onClick(params) {
  const ev = params?.data?.value?.[3];
  if (ev?.id) store.selectEvent(ev.id);
}
</script>

<template>
  <div class="timeline-wrapper">
    <VChart v-if="allEvents.length > 0" :option="option" autoresize class="chart" @click="onClick" />
    <div v-else class="empty">
      <p>🔍 没有符合条件的事件</p>
      <p class="text-secondary">
        <button class="link-btn" @click="store.clearAllFilters()">清除全部筛选</button>
      </p>
    </div>
    <div class="hint">
      <span>气泡大小 = 实体数 · 点击散点查看详情 · 点击图例筛选情感</span>
    </div>
  </div>
</template>

<style scoped>
.timeline-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chart {
  flex: 1;
  width: 100%;
  min-height: 220px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 13px;
  padding: 20px;
}

.text-secondary {
  margin-top: 8px;
  font-size: 11px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  text-decoration: underline;
  font-size: 11px;
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--color-text-secondary);
  text-align: center;
  padding-top: 4px;
  opacity: 0.8;
  flex-wrap: wrap;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.separator {
  opacity: 0.5;
  margin: 0 2px;
}
</style>
