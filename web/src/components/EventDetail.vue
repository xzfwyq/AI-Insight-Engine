<script setup>
import { computed } from 'vue';
import { useEventsStore } from '../stores/events';

const store = useEventsStore();

const ENTITY_COLORS = {
  company: '#4d9eff',
  product: '#52c41a',
  technology: '#722ed1',
  person: '#eb2f96',
  organization: '#13c2c2',
  paper: '#f5a623',
  dataset: '#fa8c16',
  method: '#a0d911',
  benchmark: '#2f54eb',
  repository: '#fadb14',
  framework: '#fa541c',
  language: '#08979c',
};

// 词典命中词去重(同一词可能命中多次,如"骂"在标题和摘要各一次)
function dedupeHits(hits) {
  if (!hits) return [];
  return [...new Set(hits)];
}

function sentimentLabel(dir) {
  return { positive: '正面', negative: '负面', neutral: '中性' }[dir] || dir;
}

// Top5 入选理由:当前事件若在 topEvents 里,返回 {rank, significance, reason}
const topEventInfo = computed(() => {
  const topEvents = store.aggregated?.topEvents || [];
  const idx = topEvents.findIndex((t) => t.id === store.selectedEvent?.id);
  if (idx === -1) return null;
  return {
    rank: idx + 1,
    significance: topEvents[idx].significance,
    reason: topEvents[idx].reason,
  };
});

/**
 * 相关事件推荐:Jaccard 相似度
 * - 实体集交集 × 0.6 + 主题集交集 × 0.4
 * - 排除当前事件,取 Top 3
 * - 市面标配:今日头条/即刻/Medium 都有"相关推荐"
 */
const relatedEvents = computed(() => {
  const current = store.selectedEvent;
  if (!current) return [];
  const currentEntities = new Set((current.entities || []).map((e) => e.name));
  const currentTopics = new Set((current.topics || []).map((t) => t.name));

  return store.events
    .filter((e) => e.id !== current.id)
    .map((e) => {
      const entities = new Set((e.entities || []).map((en) => en.name));
      const topics = new Set((e.topics || []).map((t) => t.name));
      const entityInter = [...entities].filter((x) => currentEntities.has(x));
      const topicInter = [...topics].filter((x) => currentTopics.has(x));
      const entitySim = currentEntities.size === 0 ? 0 : entityInter.length / new Set([...currentEntities, ...entities]).size;
      const topicSim = currentTopics.size === 0 ? 0 : topicInter.length / new Set([...currentTopics, ...topics]).size;
      return {
        event: e,
        score: entitySim * 0.6 + topicSim * 0.4,
        sharedEntities: entityInter,
        sharedTopics: topicInter,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
});
</script>

<template>
  <div class="event-detail">
    <div v-if="!store.selectedEvent" class="empty">
      <p>👈 点击左侧事件列表查看详情</p>
      <p class="text-secondary mt">包含:原文摘要、AI 分析、关联实体、情感、影响评估</p>
    </div>

    <div v-else class="detail-content">
      <h3 class="detail-title">{{ store.selectedEvent.title }}</h3>

      <div class="detail-meta">
        <span :class="['badge', `badge-${store.selectedEvent.language}`]">
          {{ store.selectedEvent.language === 'zh' ? '中文' : 'English' }}
        </span>
        <span class="badge">{{ store.selectedEvent.source.type }}</span>
        <span class="text-secondary">
          {{ new Date(store.selectedEvent.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}
        </span>
      </div>

      <!-- Top5 入选理由(仅 Top5 事件显示) -->
      <div v-if="topEventInfo" class="top-event-highlight">
        <div class="top-event-header">
          <span class="top-event-rank">★ Top {{ topEventInfo.rank }}</span>
          <span class="top-event-sig">重要性 {{ topEventInfo.significance.toFixed(2) }}</span>
        </div>
        <div class="top-event-label">🎯 入选理由</div>
        <div class="top-event-reason">{{ topEventInfo.reason }}</div>
      </div>

      <!-- 传播热度指标条 -->
      <div v-if="store.selectedEvent.heatScore != null" class="heat-bar">
        <span class="heat-label">传播热度</span>
        <div class="heat-progress">
          <div
            class="heat-fill"
            :style="{
              width: (store.selectedEvent.heatScore) + '%',
              background: store.selectedEvent.heatScore >= 80 ? '#ff4d4f' :
                         store.selectedEvent.heatScore >= 60 ? '#fa8c16' :
                         store.selectedEvent.heatScore >= 40 ? '#fadb14' : '#52c41a'
            }"
          ></div>
        </div>
        <span class="heat-score">{{ store.selectedEvent.heatScore }}/100</span>
      </div>

      <div v-if="store.selectedEvent.source.url" class="detail-source">
        <a :href="store.selectedEvent.source.url" target="_blank" rel="noopener">
          原文链接 ↗
        </a>
      </div>

      <div class="section">
        <div class="section-title">摘要</div>
        <p class="section-text">{{ store.selectedEvent.summary }}</p>
      </div>

      <div v-if="store.selectedEvent.entities?.length" class="section">
        <div class="section-title">关联实体 ({{ store.selectedEvent.entities.length }})</div>
        <div class="entity-list">
          <span
            v-for="e in store.selectedEvent.entities"
            :key="e.name"
            class="entity-chip"
            :style="{ borderColor: ENTITY_COLORS[e.type] || '#8c8c8c' }"
            @click="store.selectEntity(e.name)"
          >
            <span class="entity-type" :style="{ color: ENTITY_COLORS[e.type] || '#8c8c8c' }">{{ e.type }}</span>
            <span class="entity-name">{{ e.name }}</span>
            <span v-if="e.role" class="entity-role">{{ e.role }}</span>
          </span>
        </div>
      </div>

      <div v-if="store.selectedEvent.topics?.length" class="section">
        <div class="section-title">主题标签</div>
        <div class="topic-list">
          <span v-for="t in store.selectedEvent.topics" :key="t.name" class="topic-tag" @click="store.selectTopic(t.name)">
            {{ t.name }} <small>({{ t.confidence?.toFixed(2) }})</small>
          </span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">情感分析 <span class="method-tag">{{ store.selectedEvent.sentiment.method === 'lexicon' ? '词典' : 'AI' }}</span></div>
        <div class="sentiment-box">
          <span :class="['sentiment-direction', store.selectedEvent.sentiment.direction]">
            {{ store.selectedEvent.sentiment.direction === 'positive' ? '正面' : store.selectedEvent.sentiment.direction === 'negative' ? '负面' : '中性' }}
          </span>
          <span class="sentiment-score">分数: {{ store.selectedEvent.sentiment.score?.toFixed(3) }}</span>
        </div>
        <!-- 词典法可解释性:展示命中的正负面词 -->
        <div v-if="store.selectedEvent.sentiment.method === 'lexicon'" class="lexicon-hits">
          <div v-if="store.selectedEvent.sentiment.posHits?.length" class="hit-row">
            <span class="hit-label positive">正面词命中</span>
            <span v-for="w in dedupeHits(store.selectedEvent.sentiment.posHits)" :key="w" class="hit-chip positive">{{ w }}</span>
          </div>
          <div v-if="store.selectedEvent.sentiment.negHits?.length" class="hit-row">
            <span class="hit-label negative">负面词命中</span>
            <span v-for="w in dedupeHits(store.selectedEvent.sentiment.negHits)" :key="w" class="hit-chip negative">{{ w }}</span>
          </div>
          <div v-if="store.selectedEvent.originalSentiment && store.selectedEvent.originalSentiment.direction !== store.selectedEvent.sentiment.direction" class="ai-vs-lexicon">
            AI 原判: {{ sentimentLabel(store.selectedEvent.originalSentiment.direction) }}({{ store.selectedEvent.originalSentiment.score?.toFixed(2) }}) → 词典修正
          </div>
        </div>
      </div>

      <div v-if="store.selectedEvent.impact?.scope" class="section">
        <div class="section-title">影响评估</div>
        <div class="impact-box">
          <div><strong>范围:</strong> {{ store.selectedEvent.impact.scope }}</div>
          <div v-if="store.selectedEvent.impact.timeHorizon">
            <strong>时间窗口:</strong> {{ store.selectedEvent.impact.timeHorizon }}
          </div>
          <div v-if="store.selectedEvent.impact.affectedEntities?.length">
            <strong>受影响实体:</strong> {{ store.selectedEvent.impact.affectedEntities.join(', ') }}
          </div>
        </div>
      </div>

      <div v-if="store.selectedEvent.source.metadata" class="section">
        <div class="section-title">元数据</div>
        <pre class="metadata">{{ JSON.stringify(store.selectedEvent.source.metadata, null, 2) }}</pre>
      </div>

      <!-- 相关事件推荐:Jaccard 相似度(实体×0.6 + 主题×0.4) -->
      <div v-if="relatedEvents.length" class="section">
        <div class="section-title">相关事件 <span class="count-hint">{{ relatedEvents.length }} 条</span></div>
        <div class="related-list">
          <div
            v-for="r in relatedEvents"
            :key="r.event.id"
            class="related-item"
            @click="store.selectEvent(r.event.id)"
          >
            <div class="related-title">{{ r.event.title }}</div>
            <div class="related-meta">
              <span v-if="r.sharedEntities.length" class="shared-tag entity">
                共享实体: {{ r.sharedEntities.slice(0, 3).join('、') }}
              </span>
              <span v-if="r.sharedTopics.length" class="shared-tag topic">
                共享主题: {{ r.sharedTopics.slice(0, 3).join('、') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-detail {
  min-height: 400px;
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary);
}

.detail-title {
  font-size: 16px;
  line-height: 1.5;
  margin-bottom: 12px;
}

.top-event-highlight {
  margin-bottom: 14px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(82, 196, 26, 0.08), rgba(77, 158, 255, 0.08));
  border-left: 3px solid var(--color-positive);
  border-radius: 6px;
}

.top-event-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.top-event-rank {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-positive);
  background: rgba(82, 196, 26, 0.15);
  padding: 2px 10px;
  border-radius: 10px;
}

.top-event-sig {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.top-event-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 4px;
}

.top-event-reason {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text);
  font-weight: 500;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}

.detail-source {
  margin-bottom: 16px;
}

.heat-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bg);
  border-radius: 6px;
  margin-bottom: 16px;
}

.heat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.heat-progress {
  flex: 1;
  height: 8px;
  background: var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.heat-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.heat-score {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text);
  white-space: nowrap;
}

.section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
}

.section-text {
  line-height: 1.7;
  font-size: 13px;
}

.entity-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entity-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.entity-chip:hover {
  background: var(--color-border);
}

.entity-type {
  font-size: 10px;
  opacity: 0.8;
}

.entity-name {
  font-weight: 500;
}

.entity-role {
  color: var(--color-text-secondary);
  font-size: 10px;
}

.topic-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.topic-tag {
  background: rgba(114, 46, 209, 0.2);
  color: #b37feb;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.topic-tag:hover {
  background: rgba(114, 46, 209, 0.4);
}

.sentiment-box {
  display: flex;
  gap: 12px;
  align-items: center;
}

.sentiment-direction {
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.sentiment-direction.positive {
  background: rgba(82, 196, 26, 0.2);
  color: var(--color-positive);
}

.sentiment-direction.negative {
  background: rgba(255, 77, 79, 0.2);
  color: var(--color-negative);
}

.sentiment-direction.neutral {
  background: rgba(140, 140, 140, 0.2);
  color: var(--color-neutral);
}

.sentiment-score {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.method-tag {
  font-size: 10px;
  font-weight: 500;
  background: rgba(140, 140, 140, 0.2);
  color: var(--color-text-secondary);
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: 6px;
  text-transform: none;
}

.lexicon-hits {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hit-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.hit-label {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 4px;
}

.hit-label.positive {
  background: rgba(82, 196, 26, 0.15);
  color: var(--color-positive);
}

.hit-label.negative {
  background: rgba(255, 77, 79, 0.15);
  color: var(--color-negative);
}

.hit-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid;
}

.hit-chip.positive {
  border-color: var(--color-positive);
  color: var(--color-positive);
}

.hit-chip.negative {
  border-color: var(--color-negative);
  color: var(--color-negative);
}

.ai-vs-lexicon {
  font-size: 10px;
  color: var(--color-text-secondary);
  margin-top: 4px;
  padding: 4px 6px;
  background: var(--color-bg);
  border-radius: 3px;
  border-left: 2px solid var(--color-primary);
}

.impact-box {
  font-size: 12px;
  line-height: 1.8;
  color: var(--color-text-secondary);
}

.metadata {
  background: var(--color-bg);
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
  overflow-x: auto;
  color: var(--color-text-secondary);
}

.count-hint {
  font-size: 10px;
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-left: 4px;
}

.related-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.related-item {
  padding: 8px 10px;
  background: var(--color-bg);
  border-radius: 4px;
  border-left: 2px solid var(--color-primary);
  cursor: pointer;
  transition: all 0.15s;
}

.related-item:hover {
  background: rgba(77, 158, 255, 0.08);
  transform: translateX(2px);
}

.related-title {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 4px;
}

.related-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.shared-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
}

.shared-tag.entity {
  background: rgba(77, 158, 255, 0.15);
  color: var(--color-primary);
}

.shared-tag.topic {
  background: rgba(114, 46, 209, 0.15);
  color: #b37feb;
}
</style>
