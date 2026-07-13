<script setup>
import { ref, watch, nextTick, computed } from 'vue';
import { useEventsStore } from '../stores/events';

const store = useEventsStore();
const listRef = ref(null);
const currentPage = ref(1);
const PAGE_SIZE = 8;

const SOURCE_LABELS = {
  hf_papers: 'HF 论文',
  hn: 'HN',
  devto: 'Dev.to',
  techcrunch: 'TechCrunch',
  '36kr': '36氪',
  zhihu: '知乎',
  github: 'GitHub',
};

function sentimentColor(direction) {
  if (direction === 'positive') return 'var(--color-positive)';
  if (direction === 'negative') return 'var(--color-negative)';
  return 'var(--color-neutral)';
}

function sentimentLabel(direction) {
  return { positive: '正面', negative: '负面', neutral: '中性' }[direction] || '';
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000 / 60;
  if (diff < 60) return `${Math.floor(diff)}分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)}小时前`;
  return d.toLocaleDateString('zh-CN');
}

function heatColor(score) {
  if (score >= 80) return '#ff4d4f';
  if (score >= 60) return '#fa8c16';
  if (score >= 40) return '#fadb14';
  return '#52c41a';
}

function heatLabel(score) {
  if (score >= 80) return '🔥 爆';
  if (score >= 60) return '热';
  if (score >= 40) return '温';
  return '冷';
}

// 按热度排序(精选模式)
const sortedEvents = computed(() => {
  const events = [...store.filteredEvents];
  if (!store.showAllEvents) {
    events.sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));
  } else {
    events.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }
  return events;
});

// 精选模式:Top 5;全部模式:分页
const totalPages = computed(() => Math.max(1, Math.ceil(sortedEvents.value.length / PAGE_SIZE)));

const displayEvents = computed(() => {
  if (!store.showAllEvents) return sortedEvents.value.slice(0, 5);
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return sortedEvents.value.slice(start, start + PAGE_SIZE);
});

function goToPage(page) {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = 0;
  });
}

// 筛选/模式切换时重置页码 + 自动选中第一个事件
watch(
  () => [store.filteredEvents, store.showAllEvents],
  ([newEvents]) => {
    if (!newEvents || newEvents.length === 0) return;
    currentPage.value = 1;
    const currentId = store.selectedEventId;
    if (!currentId || !newEvents.some((e) => e.id === currentId)) {
      store.selectEvent(newEvents[0].id);
      nextTick(() => {
        if (listRef.value) listRef.value.scrollTop = 0;
      });
    }
  },
  { immediate: true }
);

// 选中事件变化时(如顶部洞察卡片点击),若在"全部"模式且目标不在当前页,翻到目标页
// 翻页后还要把目标事件滚到可视区域中央,否则它在第 5-8 位时会藏在折叠下方
function scrollEventIntoView(eventId) {
  if (!eventId) return;
  nextTick(() => {
    const el = listRef.value?.querySelector(`[data-event-id="${eventId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (listRef.value) {
      listRef.value.scrollTop = 0;
    }
  });
}

watch(
  () => store.selectedEventId,
  (newId) => {
    if (!newId || !store.showAllEvents) return;
    const idx = sortedEvents.value.findIndex((e) => e.id === newId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (targetPage !== currentPage.value) {
      currentPage.value = targetPage;
      // 翻页后 DOM 重新渲染,用两次 nextTick 确保目标元素已挂载
      nextTick(() => scrollEventIntoView(newId));
    } else {
      // 同页,直接滚到目标
      scrollEventIntoView(newId);
    }
  }
);
</script>

<template>
  <div class="event-list-wrapper">
    <div class="list-header">
      <div class="mode-toggle">
        <button :class="['toggle-btn', { active: !store.showAllEvents }]" @click="store.setShowAllEvents(false)">
          🎯 精选 Top {{ Math.min(5, sortedEvents.length) }}
        </button>
        <button :class="['toggle-btn', { active: store.showAllEvents }]" @click="store.setShowAllEvents(true)">
          📋 全部 {{ sortedEvents.length }}
        </button>
      </div>
    </div>

    <div ref="listRef" class="event-list">
      <div
        v-for="(ev, idx) in displayEvents"
        :key="ev.id"
        :data-event-id="ev.id"
        :class="['event-item', { active: store.selectedEvent?.id === ev.id }]"
        @click="store.selectEvent(ev.id)"
      >
        <!-- 选中指示器:左侧色条 -->
        <div class="active-indicator"></div>
        <div class="event-header">
          <span class="rank" v-if="!store.showAllEvents">#{{ idx + 1 }}</span>
          <span v-else class="rank-page">{{ (currentPage - 1) * PAGE_SIZE + idx + 1 }}</span>
          <span :class="['badge', `badge-${ev.language}`]">{{ ev.language === 'zh' ? '中' : 'EN' }}</span>
          <span class="badge src-badge">{{ SOURCE_LABELS[ev.source.type] || ev.source.type }}</span>
          <span class="time">{{ formatTime(ev.publishedAt) }}</span>
          <span class="heat" :style="{ color: heatColor(ev.heatScore || 0) }" :title="`热度分 ${ev.heatScore}`">
            {{ heatLabel(ev.heatScore || 0) }} {{ ev.heatScore || 0 }}
          </span>
        </div>
        <div class="event-title">{{ ev.title }}</div>
        <div class="event-summary">{{ ev.summary }}</div>
        <div class="event-meta">
          <span class="entities">
            <span v-for="e in (ev.entities || []).slice(0, 3)" :key="e.name" class="entity-tag">
              {{ e.name }}
            </span>
            <span v-if="(ev.entities || []).length > 3" class="entity-tag more">
              +{{ ev.entities.length - 3 }}
            </span>
          </span>
          <span class="sentiment" :style="{ color: sentimentColor(ev.sentiment.direction) }">
            {{ sentimentLabel(ev.sentiment.direction) }}
          </span>
        </div>
      </div>

      <!-- 分页控件(仅全部模式) -->
      <div v-if="store.showAllEvents && totalPages > 1" class="pagination">
        <button class="page-btn" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">‹ 上一页</button>
        <div class="page-numbers">
          <button
            v-for="p in totalPages"
            :key="p"
            :class="['page-num', { active: p === currentPage }]"
            @click="goToPage(p)"
          >{{ p }}</button>
        </div>
        <button class="page-btn" :disabled="currentPage === totalPages" @click="goToPage(currentPage + 1)">下一页 ›</button>
      </div>

      <div v-if="store.filteredEvents.length === 0" class="empty">
        <p>🔍 没有符合条件的事件</p>
        <p class="text-secondary mt">
          <button class="link-btn" @click="store.clearAllFilters()">清除全部筛选</button>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-list-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.list-header {
  padding: 0 0 8px 0;
  border-bottom: 1px dashed var(--color-border);
  margin-bottom: 8px;
}

.mode-toggle {
  display: flex;
  gap: 4px;
}

.toggle-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}

.toggle-btn.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.event-list {
  flex: 1;
  overflow-y: auto;
  margin: 0 -8px;
  padding: 0 8px;
}

.event-item {
  position: relative;
  padding: 12px 12px 12px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.18s;
  border: 1px solid transparent;
  margin-bottom: 6px;
}

.event-item:hover {
  background: rgba(77, 158, 255, 0.06);
  border-color: rgba(77, 158, 255, 0.3);
}

.event-item.active {
  background: rgba(77, 158, 255, 0.14);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary), 0 4px 12px rgba(77, 158, 255, 0.15);
}

/* 选中指示器:左侧高亮色条,2px 宽,从顶到底 */
.active-indicator {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: transparent;
  border-radius: 6px 0 0 6px;
  transition: background 0.18s;
}

.event-item.active .active-indicator {
  background: var(--color-primary);
  box-shadow: 0 0 8px var(--color-primary);
}

.event-item:hover .active-indicator {
  background: rgba(77, 158, 255, 0.5);
}

.event-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
}

.rank {
  font-weight: 700;
  color: var(--color-primary);
  font-size: 12px;
}

.src-badge {
  background: rgba(140, 140, 140, 0.2);
  color: var(--color-text-secondary);
}

.time {
  color: var(--color-text-secondary);
  margin-left: auto;
}

.heat {
  font-weight: 700;
  white-space: nowrap;
}

.event-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 6px;
  color: var(--color-text);
}

.event-summary {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
}

.event-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  gap: 8px;
}

.entities {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  overflow: hidden;
  flex: 1;
}

.entity-tag {
  background: var(--color-border);
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.entity-tag.more {
  opacity: 0.7;
}

.sentiment {
  font-weight: 600;
  white-space: nowrap;
}

.show-more {
  text-align: center;
  padding: 12px;
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  margin-top: 4px;
}

.show-more:hover {
  background: rgba(77, 158, 255, 0.05);
}

.rank-page {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 22px;
  text-align: center;
  background: var(--color-border);
  border-radius: 3px;
  padding: 1px 4px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px dashed var(--color-border);
  margin-top: 8px;
}

.page-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-numbers {
  display: flex;
  gap: 4px;
}

.page-num {
  min-width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.15s;
}

.page-num:hover:not(.active) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.page-num.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  text-decoration: underline;
  font-size: 12px;
}
</style>
