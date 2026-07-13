import { defineStore } from 'pinia';
import { ref, computed, watch, nextTick } from 'vue';
import { loadAll } from '../api';

export const useEventsStore = defineStore('events', () => {
  const events = ref([]);
  const aggregated = ref(null);
  const loading = ref(false);
  const error = ref(null);
  const refreshing = ref(false);
  const refreshLogs = ref([]);
  const lastRefreshedAt = ref(null);

  // 筛选状态
  const selectedEntity = ref(null);
  const selectedTopic = ref(null);
  const selectedEventId = ref(null);
  const languageFilter = ref('all');
  const sourceFilter = ref(null); // 新增:按数据源筛选
  const searchQuery = ref(''); // 搜索框:匹配标题/摘要/实体名
  const showAllEvents = ref(false); // 事件列表显示模式:false=精选Top5, true=全部

  /**
   * 修复 AI 生成的 eventId 不匹配问题
   * AI 在 Reduce 阶段有两种失败模式:
   * 1. eventId 拼错(如 zhihu_7a3c9e2f1b8d4a5c 写成 zhihu_a3c9e2f1b8d4a5c)
   * 2. eventId 完全漏填(如 opportunities[1] 没有 eventId 字段)
   * 两者都会导致点击"无效"(fallback 到第一个事件)或按钮不渲染
   *
   * 修复策略:
   * - id 在 events 里:直接用
   * - id 不在或缺失:用关键词做 includes 双向匹配反查
   *   - keyPoints.text 是总结句,取前 8 字
   *   - risks/opportunities 优先用 description(含具体实体名),fallback 到 title
   *   - topEvents.title 是事件标题本身,直接全匹配
   * - 阈值:关键词 ≥ 4 字才匹配,避免短词误命中
   */
  function fixMismatchedEventIds(agg, eventList) {
    if (!agg || !eventList?.length) return agg;
    const eventIdSet = new Set(eventList.map((e) => e.id));
    const findByKey = (keyText, prefixLen) => {
      if (!keyText) return null;
      const key = keyText.slice(0, prefixLen);
      if (key.length < 4) return null;
      return eventList.find(
        (e) => (e.title || '').includes(key) || key.includes(e.title?.slice(0, prefixLen) || '')
      );
    };
    const fixOne = (id, keyText, prefixLen = 8) => {
      if (id && eventIdSet.has(id)) return id; // id 有效,直接用
      // id 缺失或拼错,用关键词反查
      const match = findByKey(keyText, prefixLen);
      return match?.id || id; // 反查不到保留原值(可能是 undefined)
    };
    if (agg.keyPoints?.length) {
      agg.keyPoints = agg.keyPoints.map((kp) => ({ ...kp, eventId: fixOne(kp.eventId, kp.text, 8) }));
    }
    if (agg.topEvents?.length) {
      agg.topEvents = agg.topEvents.map((t) => ({ ...t, id: fixOne(t.id, t.title, 12) }));
    }
    if (agg.risks?.length) {
      // risks.title 是归纳句,description 含具体实体名,优先用 description 反查
      agg.risks = agg.risks.map((r) => ({ ...r, eventId: fixOne(r.eventId, r.description || r.title, 8) }));
    }
    if (agg.opportunities?.length) {
      agg.opportunities = agg.opportunities.map((o) => ({ ...o, eventId: fixOne(o.eventId, o.description || o.title, 8) }));
    }
    return agg;
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const { events: ev, aggregated: agg } = await loadAll();
      // 优先用 aggregated.enrichedEvents(已归一化主题 + 带 heatScore),
      // 这样前端知识图谱/列表/详情都用归一化后的主题,不会有长尾问题
      this.events = (agg?.enrichedEvents && agg.enrichedEvents.length > 0) ? agg.enrichedEvents : ev;
      // 修复 AI 生成的 eventId 不匹配(keyPoints/topEvents 偶尔拼错)
      this.aggregated = fixMismatchedEventIds(agg, this.events);
      // 默认选中第一个事件
      if (this.events.length > 0) {
        selectedEventId.value = this.events[0].id;
      }
    } catch (err) {
      error.value = err.message;
      console.error('加载数据失败:', err);
    } finally {
      loading.value = false;
    }
  }

  // 计算属性:筛选后的事件
  const filteredEvents = computed(() => {
    let result = events.value;
    if (languageFilter.value !== 'all') {
      result = result.filter((e) => e.language === languageFilter.value);
    }
    if (sourceFilter.value) {
      result = result.filter((e) => e.source.type === sourceFilter.value);
    }
    if (selectedEntity.value) {
      result = result.filter((e) =>
        e.entities.some((en) => en.name === selectedEntity.value)
      );
    }
    if (selectedTopic.value) {
      // 大小写不敏感匹配(修复 bug)
      const topicLower = selectedTopic.value.toLowerCase();
      result = result.filter((e) =>
        e.topics.some((t) => t.name.toLowerCase() === topicLower)
      );
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      result = result.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        (e.summary || '').toLowerCase().includes(q) ||
        (e.entities || []).some((en) => en.name.toLowerCase().includes(q)) ||
        (e.topics || []).some((t) => t.name.toLowerCase().includes(q))
      );
    }
    return result;
  });

  // 当前选中的事件(优先用 selectedEventId,若不在筛选结果里则取第一个)
  const selectedEvent = computed(() => {
    if (!events.value.length) return null;
    const found = events.value.find((e) => e.id === selectedEventId.value);
    if (found && filteredEvents.value.some((e) => e.id === found.id)) {
      return found;
    }
    // 选中事件不在筛选结果里,自动选第一个
    return filteredEvents.value[0] || null;
  });

  // 筛选变化时,如果当前选中事件不在新结果里,同步 selectedEventId 到第一个
  // 这修复了"点击实体筛选,详情面板不更新"的 bug — 之前 selectedEvent computed
  // 会 fallback 但 selectedEventId 不变,EventList 的 watch 判断 currentSelected
  // (已是 fallback 后的第一个)在 newEvents 里,就不更新 selectedEventId
  watch(filteredEvents, (newEvents) => {
    if (newEvents.length === 0) return;
    const currentId = selectedEventId.value;
    if (!currentId || !newEvents.some((e) => e.id === currentId)) {
      selectedEventId.value = newEvents[0].id;
    }
  });

  // 当前是否有任何筛选条件
  const hasActiveFilter = computed(() =>
    languageFilter.value !== 'all' ||
    !!sourceFilter.value ||
    !!selectedEntity.value ||
    !!selectedTopic.value ||
    !!searchQuery.value.trim()
  );

  const activeFilterCount = computed(() => {
    let n = 0;
    if (languageFilter.value !== 'all') n++;
    if (sourceFilter.value) n++;
    if (selectedEntity.value) n++;
    if (selectedTopic.value) n++;
    if (searchQuery.value.trim()) n++;
    return n;
  });

  function selectEntity(name) {
    selectedEntity.value = selectedEntity.value === name ? null : name;
  }

  function selectTopic(topic) {
    selectedTopic.value = selectedTopic.value === topic ? null : topic;
  }

  function selectEvent(id, options = {}) {
    // 顶部洞察卡片(核心要点/风险/机会)点击时,若目标事件被当前筛选或列表模式排除,
    // 清空筛选 + 切到"全部"模式让其可见 — 否则 selectedEvent 会 fallback 到第一个,点击"失效"
    // 这同时让 FilterBar 的"全部"高亮 + EventList 的"全部"高亮,符合"切换到全部"的用户预期
    if (options.ensureVisible) {
      const inFiltered = filteredEvents.value.some((e) => e.id === id);
      if (!inFiltered) {
        clearAllFilters();
      }
      // 精选 Top5 模式下,目标事件若不在 heatScore 前 5,切到"全部"
      if (!showAllEvents.value) {
        const top5 = [...filteredEvents.value]
          .sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0))
          .slice(0, 5);
        if (!top5.some((e) => e.id === id)) {
          showAllEvents.value = true;
        }
      }
    }
    selectedEventId.value = id;
    // 顶部区块(风险预警/核心要点)点击后,滚动到详情区让用户看到变化
    // EventList 内部点击不传 scroll,避免不必要的滚动
    if (options.scroll) {
      nextTick(() => {
        document.getElementById('main-flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function setLanguageFilter(lang) {
    languageFilter.value = lang;
  }

  function setSourceFilter(source) {
    sourceFilter.value = sourceFilter.value === source ? null : source;
  }

  function clearAllFilters() {
    languageFilter.value = 'all';
    sourceFilter.value = null;
    selectedEntity.value = null;
    selectedTopic.value = null;
    searchQuery.value = '';
  }

  function setShowAllEvents(val) {
    showAllEvents.value = !!val;
  }

  function setSearchQuery(q) {
    searchQuery.value = q || '';
  }

  /**
   * 触发后端 Pipeline 刷新数据(SSE 流式日志)
   * 市面标配:HN refresh、即刻下拉刷新
   */
  async function refresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    refreshLogs.value = [];
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const msg = JSON.parse(line.slice(6));
              refreshLogs.value.push(msg.data);
              if (msg.type === 'done' || msg.type === 'error') {
                if (msg.type === 'done') {
                  await load();
                  lastRefreshedAt.value = new Date().toISOString();
                } else {
                  error.value = msg.data;
                }
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      error.value = err.message;
      console.error('刷新失败:', err);
    } finally {
      refreshing.value = false;
    }
  }

  return {
    events,
    aggregated,
    loading,
    error,
    refreshing,
    refreshLogs,
    lastRefreshedAt,
    selectedEntity,
    selectedTopic,
    selectedEventId,
    languageFilter,
    sourceFilter,
    searchQuery,
    showAllEvents,
    filteredEvents,
    selectedEvent,
    hasActiveFilter,
    activeFilterCount,
    load,
    refresh,
    selectEntity,
    selectTopic,
    selectEvent,
    setLanguageFilter,
    setSourceFilter,
    setShowAllEvents,
    setSearchQuery,
    clearAllFilters,
  };
});
