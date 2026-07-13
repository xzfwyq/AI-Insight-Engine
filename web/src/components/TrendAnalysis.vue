<script setup>
import { computed } from 'vue';
import { useEventsStore } from '../stores/events';

const store = useEventsStore();

const trends = computed(() => store.aggregated?.trends || []);

const DIMENSION_ICONS = {
  技术: '🔬', 应用: '🚀', 竞争: '⚔️', 资本: '💰', 政策: '📜',
};

// 趋势点击后,滚到详情区让用户看到事件切换
function handleClick(eventId) {
  if (!eventId) return;
  store.selectEvent(eventId, { scroll: true, ensureVisible: true });
}
</script>

<template>
  <div class="trend-analysis">
    <!-- 趋势分栏 -->
    <div v-if="trends.length" class="section">
      <div class="section-title">📈 趋势分析(按维度)</div>
      <div class="trends-grid">
        <div v-for="t in trends" :key="t.dimension" class="trend-column">
          <div class="dim-header">
            <span class="dim-icon">{{ DIMENSION_ICONS[t.dimension] || '📌' }}</span>
            <span class="dim-name">{{ t.dimension }}</span>
          </div>
          <ul class="bullet-list">
            <li v-for="(b, i) in t.bullets" :key="i" class="bullet-item">
              <span class="bullet-dot"></span>
              <span class="bullet-text">{{ b.text }}</span>
              <button
                v-if="b.eventId"
                class="bullet-link"
                @click="handleClick(b.eventId)"
                title="查看支撑事件"
              >→</button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trend-analysis {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section {
  display: flex;
  flex-direction: column;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 12px;
}

.trends-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.trend-column {
  background: var(--color-bg);
  border-radius: 6px;
  padding: 12px;
  border-top: 2px solid var(--color-primary);
}

.dim-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--color-border);
}

.dim-icon {
  font-size: 14px;
}

.dim-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.bullet-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bullet-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text);
}

.bullet-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-primary);
  margin-top: 7px;
  flex-shrink: 0;
}

.bullet-text {
  flex: 1;
}

.bullet-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.bullet-link:hover {
  opacity: 1;
}
</style>
