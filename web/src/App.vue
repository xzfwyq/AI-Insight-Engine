<script setup>
import { onMounted, computed } from 'vue';
import { useEventsStore } from './stores/events';
import Dashboard from './views/Dashboard.vue';

const store = useEventsStore();

onMounted(() => {
  store.load();
});

// 数据新鲜度:< 6h 绿, < 24h 黄, > 24h 红
const freshness = computed(() => {
  const ts = store.lastRefreshedAt || store.aggregated?.generatedAt;
  if (!ts) return null;
  const hours = (Date.now() - new Date(ts).getTime()) / 3600000;
  if (hours < 6) return { level: 'fresh', label: '新鲜', color: '#52c41a' };
  if (hours < 24) return { level: 'ok', label: '可接受', color: '#fadb14' };
  return { level: 'stale', label: '过期', color: '#ff4d4f' };
});

const lastRefreshLabel = computed(() => {
  const ts = store.lastRefreshedAt || store.aggregated?.generatedAt;
  if (!ts) return '';
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 60000;
  // 绝对时间 + 相对时间组合,避免"刚刚"模糊
  const absTime = d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  let rel;
  if (diff < 1) rel = '不到 1 分钟前';
  else if (diff < 60) rel = `${Math.floor(diff)} 分钟前`;
  else if (diff < 1440) rel = `${Math.floor(diff / 60)} 小时前`;
  else rel = `${Math.floor(diff / 1440)} 天前`;
  return `${absTime} · ${rel}`;
});
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-inner">
        <div class="logo">
          <span class="logo-icon">⚡</span>
          <span class="logo-text">AI Insight Engine</span>
        </div>
        <div class="header-meta">
          <span v-if="freshness" class="freshness" :style="{ color: freshness.color }">
            <span class="freshness-dot" :style="{ background: freshness.color }"></span>
            {{ freshness.label }} · {{ lastRefreshLabel }}
          </span>
          <span v-if="store.aggregated" class="text-secondary">
            · {{ store.events.length }} 条事件
          </span>
          <button
            class="refresh-btn"
            :disabled="store.refreshing"
            @click="store.refresh()"
          >
            <span :class="['refresh-icon', { spinning: store.refreshing }]">🔄</span>
            {{ store.refreshing ? '刷新中...' : '刷新数据' }}
          </button>
        </div>
      </div>
    </header>

    <!-- 刷新进度面板(流式日志) -->
    <transition name="slide-down">
      <div v-if="store.refreshing" class="refresh-panel">
        <div class="refresh-panel-header">
          <span>🚀 Pipeline 执行中</span>
        </div>
        <pre class="refresh-logs">{{ store.refreshLogs.join('') }}</pre>
      </div>
    </transition>

    <main class="main">
      <Dashboard v-if="store.events.length" />
      <div v-else-if="store.loading" class="empty">数据加载中...</div>
      <div v-else-if="store.error" class="empty error">
        <p>❌ 数据加载失败</p>
        <p class="text-secondary">{{ store.error }}</p>
        <p class="text-secondary mt">
          提示:请先运行 <code>npm run pipeline</code> 或点击右上角"刷新数据"
        </p>
      </div>
    </main>

    <footer class="footer">
      <span class="text-secondary">
        AI Insight Engine · Vue 3 + AntV G6 + Anthropic SDK
      </span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-inner {
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}

.logo-icon {
  font-size: 22px;
}

.main {
  flex: 1;
  max-width: 1600px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
}

@media (max-width: 1024px) {
  .main {
    padding: 16px;
  }
  .header {
    padding: 10px 16px;
  }
  .header-inner {
    flex-wrap: wrap;
    gap: 8px;
  }
}

.footer {
  border-top: 1px solid var(--color-border);
  padding: 12px 24px;
  text-align: center;
  font-size: 12px;
}

.empty {
  text-align: center;
  padding: 80px 20px;
  font-size: 16px;
}

.empty.error {
  color: var(--color-negative);
}

code {
  background: var(--color-border);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Menlo', monospace;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.freshness {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
}

.freshness-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-primary);
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  background: #3a8aef;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.refresh-icon {
  display: inline-block;
  font-size: 13px;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.refresh-panel {
  max-width: 1600px;
  margin: 0 auto;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-top: 12px;
  overflow: hidden;
}

.refresh-panel-header {
  padding: 8px 14px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  font-weight: 600;
}

.refresh-logs {
  padding: 10px 14px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.25s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
