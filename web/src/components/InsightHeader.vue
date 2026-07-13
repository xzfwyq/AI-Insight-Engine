<script setup>
import { computed } from 'vue';
import { useEventsStore } from '../stores/events';

const store = useEventsStore();

// 今日洞察:用 AI 生成的 headline(具体而非空洞)
const headline = computed(() => store.aggregated?.headline || '');

// 核心要点:3 条 keyPoints,每条可点击跳转
const keyPoints = computed(() => store.aggregated?.keyPoints || []);

const reportDate = computed(() => {
  if (!store.aggregated?.generatedAt) return '';
  return new Date(store.aggregated.generatedAt).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Shanghai',
  });
});

function handleKpClick(eventId) {
  store.selectEvent(eventId, { scroll: true, ensureVisible: true });
}
</script>

<template>
  <div class="insight-header card">
    <div class="header-top">
      <div class="date-badge">
        <span class="date-icon">📅</span>
        {{ reportDate }} AI 舆情日报
      </div>
      <div class="stats">
        <span>{{ store.events.length }} 条事件</span>
        <span class="divider">·</span>
        <span>{{ store.aggregated?.topEntities?.length || 0 }} 个实体</span>
        <span class="divider">·</span>
        <span>{{ store.aggregated?.languageDistribution?.zh || 0 }} 中 / {{ store.aggregated?.languageDistribution?.en || 0 }} 英</span>
      </div>
    </div>

    <div v-if="headline" class="headline">
      <span class="headline-icon">💡</span>
      <div class="headline-text">
        <div class="headline-label">今日洞察</div>
        <div class="headline-content">{{ headline }}</div>
      </div>
    </div>

    <div v-if="keyPoints.length" class="key-points">
      <div class="kp-title">🎯 核心要点</div>
      <div class="kp-list">
        <div
          v-for="(kp, i) in keyPoints"
          :key="i"
          class="kp-item"
          @click="handleKpClick(kp.eventId)"
        >
          <div class="kp-rank">{{ i + 1 }}</div>
          <div class="kp-content">
            <div class="kp-text">{{ kp.text }}</div>
            <div class="kp-source">→ 点击查看支撑事件</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.insight-header {
  padding: 20px 24px;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.date-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.date-icon {
  font-size: 14px;
}

.stats {
  font-size: 12px;
  color: var(--color-text-secondary);
  display: flex;
  gap: 8px;
}

.divider {
  opacity: 0.5;
}

.headline {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(77, 158, 255, 0.08), rgba(114, 46, 209, 0.08));
  border-left: 3px solid var(--color-primary);
  border-radius: 6px;
  margin-bottom: 16px;
}

.headline-icon {
  font-size: 20px;
  line-height: 1.5;
}

.headline-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.headline-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text);
  font-weight: 500;
}

.key-points {
  margin-top: 4px;
}

.kp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 10px;
}

.kp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kp-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bg);
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--color-border);
  transition: all 0.15s;
}

.kp-item:hover {
  border-color: var(--color-primary);
  background: rgba(77, 158, 255, 0.05);
}

.kp-rank {
  font-size: 16px;
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1.2;
  min-width: 20px;
}

.kp-content {
  flex: 1;
  min-width: 0;
}

.kp-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text);
  margin-bottom: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kp-source {
  font-size: 11px;
  color: var(--color-text-secondary);
}
</style>
