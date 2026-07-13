<script setup>
import { ref } from 'vue';
import { useEventsStore } from '../stores/events';
import InsightHeader from '../components/InsightHeader.vue';
import RiskAlerts from '../components/RiskAlerts.vue';
import FilterBar from '../components/FilterBar.vue';
import EventList from '../components/EventList.vue';
import EventDetail from '../components/EventDetail.vue';
import KnowledgeGraph from '../components/KnowledgeGraph.vue';
import TimelineScatter from '../components/TimelineScatter.vue';
import TrendAnalysis from '../components/TrendAnalysis.vue';

const store = useEventsStore();
const kgExpanded = ref(false);
</script>

<template>
  <div class="dashboard">
    <!-- 1. AI 简报(顶部,故事化引导) -->
    <InsightHeader />

    <!-- 2. 风险预警(决策辅助核心) -->
    <RiskAlerts />

    <!-- 3. 筛选状态条 -->
    <FilterBar />

    <!-- 4. 时间维度:热度 × 时间散点图 -->
    <div class="card mt timeline-card">
      <div class="flex-between">
        <div class="card-title">📅 事件时间分布</div>
        <span class="text-secondary hint-text">X 时间 · Y 热度 · 气泡大小 = 实体数 · 颜色 = 情感</span>
      </div>
      <TimelineScatter />
    </div>

    <!-- 5. 主体信息流:左列表 + 右详情 -->
    <div id="main-flow" class="main-flow mt">
      <div class="card list-pane">
        <EventList />
      </div>
      <div class="card detail-pane">
        <div class="pane-header">
          <span class="card-title">事件详情</span>
        </div>
        <EventDetail />
      </div>
    </div>

    <!-- 6. 知识图谱:实体 + 主题统一视图 -->
    <div class="card mt chart-card kg-card">
      <div class="flex-between">
        <div class="card-title">🧠 知识图谱(实体 + 主题)</div>
        <span class="text-secondary hint-text">同一事件中的实体与主题自动连边,揭示隐性关联</span>
      </div>
      <KnowledgeGraph @expand="kgExpanded = true" />
    </div>

    <!-- 知识图谱画中画放大 modal -->
    <Teleport to="body">
      <transition name="modal">
        <div v-if="kgExpanded" class="kg-modal-overlay" @click.self="kgExpanded = false">
          <div class="kg-modal">
            <div class="kg-modal-header">
              <span class="card-title">🧠 知识图谱(放大视图)</span>
              <div class="kg-modal-actions">
                <span class="text-secondary hint-text">点击节点筛选事件,联动列表与详情</span>
                <button class="kg-modal-close" @click="kgExpanded = false">✕ 关闭</button>
              </div>
            </div>
            <div class="kg-modal-body">
              <KnowledgeGraph :expanded="true" />
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 7. 底部:趋势分析 + 风险与机会(结构化分栏) -->
    <div v-if="store.aggregated" class="card mt analysis-card">
      <TrendAnalysis />
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--spacing);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.main-flow {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: var(--spacing);
  min-height: 600px;
}

.list-pane {
  display: flex;
  flex-direction: column;
  max-height: 700px;
  padding: 12px 16px;
}

.detail-pane {
  max-height: 700px;
  overflow-y: auto;
  padding: 16px 20px;
}

.pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.chart-card {
  height: 400px;
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
}

.kg-card {
  height: 460px;
}

.timeline-card {
  height: 300px;
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
}

.analysis-card {
  padding: 20px 24px;
}

.analysis-text {
  line-height: 1.8;
  color: var(--color-text);
  white-space: pre-wrap;
  font-size: 14px;
}

.risk-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.selected-badge {
  cursor: pointer;
  background: var(--color-primary);
  color: white;
  font-size: 11px;
}

.hint-text {
  font-size: 11px;
}

.mt {
  margin-top: 0;
}

.flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.text-secondary {
  color: var(--color-text-secondary);
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: var(--color-border);
}

/* 响应式:笔记本屏(13-15寸)单列堆叠 */
@media (max-width: 1200px) {
  .main-flow {
    grid-template-columns: 1fr;
    min-height: auto;
  }
  .list-pane,
  .detail-pane {
    max-height: 500px;
  }
}

@media (max-width: 768px) {
  .main-flow {
    gap: 12px;
  }
  .list-pane,
  .detail-pane {
    max-height: 400px;
  }
  .chart-card,
  .kg-card,
  .timeline-card {
    height: 320px;
  }
}

/* 知识图谱画中画放大 modal */
.kg-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.kg-modal {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  width: 90vw;
  max-width: 1400px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.kg-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.kg-modal-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kg-modal-close {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.kg-modal-close:hover {
  border-color: var(--color-negative);
  color: var(--color-negative);
  background: rgba(255, 77, 79, 0.06);
}

.kg-modal-body {
  flex: 1;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s;
}

.modal-enter-active .kg-modal,
.modal-leave-active .kg-modal {
  transition: transform 0.2s;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .kg-modal,
.modal-leave-to .kg-modal {
  transform: scale(0.96);
}
</style>
