<script setup>
import { computed } from 'vue';
import { useEventsStore } from '../stores/events';

const store = useEventsStore();

const SOURCE_LABELS = {
  hf_papers: 'HF 论文',
  hn: 'Hacker News',
  devto: 'Dev.to',
  techcrunch: 'TechCrunch',
  '36kr': '36氪',
  zhihu: '知乎',
  github: 'GitHub',
};

const sourceOptions = computed(() => {
  const counts = {};
  store.events.forEach((e) => {
    counts[e.source.type] = (counts[e.source.type] || 0) + 1;
  });
  return Object.entries(counts).map(([type, count]) => ({
    type, label: SOURCE_LABELS[type] || type, count,
  }));
});
</script>

<template>
  <div class="filter-bar card">
    <div class="filter-row">
      <div class="filter-section search-section">
        <span class="filter-label">搜索</span>
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            class="search-input"
            placeholder="标题 / 摘要 / 实体 / 主题"
            :value="store.searchQuery"
            @input="store.setSearchQuery($event.target.value)"
          />
          <button v-if="store.searchQuery" class="search-clear" @click="store.setSearchQuery('')">✕</button>
        </div>
      </div>

      <div class="filter-section">
        <span class="filter-label">语言</span>
        <div class="filter-group">
          <button
            v-for="lang in ['all', 'zh', 'en']"
            :key="lang"
            :class="['filter-btn', { active: store.languageFilter === lang }]"
            @click="store.setLanguageFilter(lang)"
          >
            {{ lang === 'all' ? '全部' : lang === 'zh' ? '中文' : 'English' }}
          </button>
        </div>
      </div>

      <div class="filter-section">
        <span class="filter-label">来源</span>
        <div class="filter-group source-group">
          <button
            :class="['filter-btn', { active: !store.sourceFilter }]"
            @click="store.setSourceFilter(null)"
          >全部</button>
          <button
            v-for="src in sourceOptions"
            :key="src.type"
            :class="['filter-btn', { active: store.sourceFilter === src.type }]"
            @click="store.setSourceFilter(src.type)"
          >
            {{ src.label }} <span class="src-count">{{ src.count }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="store.hasActiveFilter" class="active-filters">
      <span class="active-label">已筛选:</span>
      <span v-if="store.searchQuery" class="active-tag" @click="store.setSearchQuery('')">
        搜索: "{{ store.searchQuery }}" ✕
      </span>
      <span v-if="store.languageFilter !== 'all'" class="active-tag" @click="store.setLanguageFilter('all')">
        {{ store.languageFilter === 'zh' ? '中文' : 'English' }} ✕
      </span>
      <span v-if="store.sourceFilter" class="active-tag" @click="store.setSourceFilter(null)">
        {{ SOURCE_LABELS[store.sourceFilter] || store.sourceFilter }} ✕
      </span>
      <span v-if="store.selectedEntity" class="active-tag" @click="store.selectEntity(store.selectedEntity)">
        实体: {{ store.selectedEntity }} ✕
      </span>
      <span v-if="store.selectedTopic" class="active-tag" @click="store.selectTopic(store.selectedTopic)">
        主题: {{ store.selectedTopic }} ✕
      </span>
      <button class="clear-all" @click="store.clearAllFilters()">清除全部</button>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.filter-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-section {
  flex: 1;
  min-width: 240px;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 320px;
}

.search-icon {
  position: absolute;
  left: 8px;
  font-size: 11px;
  opacity: 0.6;
  pointer-events: none;
}

.search-input {
  flex: 1;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: 5px 26px 5px 26px;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
}

.search-input:focus {
  border-color: var(--color-primary);
}

.search-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.search-clear {
  position: absolute;
  right: 4px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
}

.search-clear:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.filter-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 32px;
}

.filter-group {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.filter-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.filter-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.filter-btn.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.src-count {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 2px;
}

.active-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px dashed var(--color-border);
}

.active-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.active-tag {
  font-size: 11px;
  background: var(--color-border);
  color: var(--color-text);
  padding: 3px 8px;
  border-radius: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.active-tag:hover {
  background: var(--color-negative);
  color: white;
}

.clear-all {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--color-negative);
  color: var(--color-negative);
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}

.clear-all:hover {
  background: var(--color-negative);
  color: white;
}
</style>
