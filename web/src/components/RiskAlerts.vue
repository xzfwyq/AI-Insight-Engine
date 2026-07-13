<script setup>
import { computed } from 'vue';
import { useEventsStore } from '../stores/events';

const store = useEventsStore();

const alerts = computed(() => store.aggregated?.riskAlerts || []);
const riskSummary = computed(() => store.aggregated?.risks || []);
const opportunities = computed(() => store.aggregated?.opportunities || []);

const levelConfig = {
  high: { label: '高风险', color: '#ff4d4f', bg: 'rgba(255, 77, 79, 0.12)', icon: '🔴' },
  medium: { label: '中风险', color: '#fa8c16', bg: 'rgba(250, 140, 22, 0.12)', icon: '🟠' },
  low: { label: '关注', color: '#fadb14', bg: 'rgba(250, 219, 20, 0.12)', icon: '🟡' },
};

const sentimentConfig = {
  positive: { label: '正面', color: 'var(--color-positive)' },
  negative: { label: '负面', color: 'var(--color-negative)' },
  neutral: { label: '中性', color: 'var(--color-neutral)' },
};

function handleClick(id) {
  if (!id) return;
  store.selectEvent(id, { scroll: true, ensureVisible: true });
}
</script>

<template>
  <div v-if="alerts.length || riskSummary.length || opportunities.length" class="risk-alerts card">
    <div v-if="alerts.length" class="alerts-header">
      <span class="title">⚠️ 风险预警</span>
      <span class="count">{{ alerts.length }} 条 · 点击查看详情</span>
    </div>
    <div v-if="alerts.length" class="alerts-list">
      <div
        v-for="alert in alerts"
        :key="alert.id"
        class="alert-item"
        :style="{ borderLeftColor: levelConfig[alert.riskLevel].color }"
        @click="handleClick(alert.id)"
      >
        <div class="alert-top">
          <span class="level-badge" :style="{ background: levelConfig[alert.riskLevel].bg, color: levelConfig[alert.riskLevel].color }">
            {{ levelConfig[alert.riskLevel].icon }} {{ levelConfig[alert.riskLevel].label }}
          </span>
          <span class="reason">{{ alert.reason }}</span>
          <span v-if="alert.sentiment" :class="['sentiment-tag', alert.sentiment.direction]">
            {{ sentimentConfig[alert.sentiment.direction]?.label || alert.sentiment.direction }}
            {{ alert.sentiment.score?.toFixed(2) }}
          </span>
        </div>
        <div class="alert-title">{{ alert.title }}</div>
        <div class="alert-summary">{{ alert.summary }}</div>
      </div>
    </div>

    <!-- 风险归纳 + 机会提示:双栏并排(左红右绿对比,参考彭博颜色编码) -->
    <div v-if="riskSummary.length || opportunities.length" class="risk-opp-grid">
      <div v-if="riskSummary.length" class="ro-column ro-risk">
        <div class="ro-header">
          <span class="ro-icon">⚠️</span>
          <span class="ro-title">风险归纳</span>
          <span class="ro-count">{{ riskSummary.length }}</span>
        </div>
        <div class="ro-list">
          <div
            v-for="(r, i) in riskSummary"
            :key="'rs'+i"
            class="ro-item"
            @click="handleClick(r.eventId)"
          >
            <div class="ro-item-title">{{ r.title }}</div>
            <div class="ro-item-desc">{{ r.description }}</div>
            <div v-if="r.eventId" class="ro-item-link">→ 查看支撑事件</div>
          </div>
        </div>
      </div>

      <div v-if="opportunities.length" class="ro-column ro-opp">
        <div class="ro-header">
          <span class="ro-icon">💡</span>
          <span class="ro-title">机会提示</span>
          <span class="ro-count">{{ opportunities.length }}</span>
        </div>
        <div class="ro-list">
          <div
            v-for="(o, i) in opportunities"
            :key="'op'+i"
            class="ro-item"
            @click="handleClick(o.eventId)"
          >
            <div class="ro-item-title">{{ o.title }}</div>
            <div class="ro-item-desc">{{ o.description }}</div>
            <div v-if="o.eventId" class="ro-item-link">→ 查看支撑事件</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.risk-alerts {
  padding: 16px 20px;
}

.alerts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.count {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alert-item {
  padding: 10px 12px;
  background: var(--color-bg);
  border-radius: 6px;
  border-left: 3px solid;
  cursor: pointer;
  transition: all 0.15s;
}

.alert-item:hover {
  background: rgba(255, 77, 79, 0.05);
  transform: translateX(2px);
}

.alert-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
}

.level-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 10px;
}

.reason {
  color: var(--color-text-secondary);
}

.sentiment-tag {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  background: var(--color-border);
}

.sentiment-tag.positive {
  background: rgba(82, 196, 26, 0.15);
  color: var(--color-positive);
}

.sentiment-tag.negative {
  background: rgba(255, 77, 79, 0.15);
  color: var(--color-negative);
}

.sentiment-tag.neutral {
  background: rgba(140, 140, 140, 0.15);
  color: var(--color-neutral);
}

.alert-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 4px;
  color: var(--color-text);
}

.alert-summary {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 风险归纳 + 机会提示:双栏并排,左红右绿对比 */
.risk-opp-grid {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-border);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.ro-column {
  background: var(--color-bg);
  border-radius: 6px;
  padding: 12px;
}

.ro-risk {
  border-top: 2px solid var(--color-negative);
}

.ro-opp {
  border-top: 2px solid var(--color-positive);
}

.ro-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--color-border);
}

.ro-icon {
  font-size: 14px;
}

.ro-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.ro-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: auto;
}

.ro-risk .ro-count {
  background: rgba(255, 77, 79, 0.15);
  color: var(--color-negative);
}

.ro-opp .ro-count {
  background: rgba(82, 196, 26, 0.15);
  color: var(--color-positive);
}

.ro-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ro-item {
  padding: 10px 12px;
  background: var(--color-card);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  border-left: 2px solid transparent;
}

.ro-risk .ro-item {
  border-left-color: rgba(255, 77, 79, 0.4);
}

.ro-opp .ro-item {
  border-left-color: rgba(82, 196, 26, 0.4);
}

.ro-item:hover {
  transform: translateX(2px);
}

.ro-risk .ro-item:hover {
  border-left-color: var(--color-negative);
  background: rgba(255, 77, 79, 0.06);
}

.ro-opp .ro-item:hover {
  border-left-color: var(--color-positive);
  background: rgba(82, 196, 26, 0.06);
}

.ro-item-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  line-height: 1.4;
}

.ro-risk .ro-item-title {
  color: var(--color-negative);
}

.ro-opp .ro-item-title {
  color: var(--color-positive);
}

.ro-item-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.ro-item-link {
  font-size: 10px;
  color: var(--color-primary);
  font-weight: 500;
}

@media (max-width: 768px) {
  .risk-opp-grid {
    grid-template-columns: 1fr;
  }
}
</style>
