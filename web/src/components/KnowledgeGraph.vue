<script setup>
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { Graph } from '@antv/g6';
import { useEventsStore } from '../stores/events';

const props = defineProps({
  expanded: { type: Boolean, default: false },
});
const emit = defineEmits(['expand']);

const store = useEventsStore();
const containerRef = ref(null);
let graph = null;

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

const ENTITY_TYPE_LABELS = {
  company: '公司', product: '产品', technology: '技术', person: '人物',
  organization: '组织', paper: '论文', dataset: '数据集', method: '方法',
  benchmark: '基准', repository: '仓库', framework: '框架', language: '语言',
};

const TOPIC_CATEGORIES = {
  技术: { color: '#4d9eff', keywords: ['llm', 'agent', 'transformer', 'attention', 'multi-agent', 'neural', 'network', 'diffusion', 'rag', 'memory', 'reasoning', 'training', 'fine-tune', 'embedding', 'reinforcement', 'supervised', 'unsupervised', 'architecture', 'tokenizer'] },
  应用: { color: '#52c41a', keywords: ['coding', 'chatbot', 'vision', 'voice', 'video', 'image', 'multimodal', 'speech', 'translation', 'summary', 'search', 'assistant', 'automation'] },
  产业: { color: '#fa8c16', keywords: ['开源', '商业化', '融资', '创业', '产品发布', '上市', '收购', '合作', '市值', '投资', '营收', '用户', '增长', '市场', '竞争'] },
  政策: { color: '#ff4d4f', keywords: ['知识产权', '诉讼', '监管', '合规', '隐私', '安全', '法律', '政策', '专利', '版权', '伦理'] },
};

const TOP_N_ENTITIES = 12;
const TOP_N_TOPICS = 8;
const MIN_TOPIC_FREQ = 2;

const viewMode = ref('all');

function classifyTopic(name) {
  const lower = name.toLowerCase();
  for (const [cat, { keywords }] of Object.entries(TOPIC_CATEGORIES)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) return cat;
  }
  return '其他';
}

function buildKnowledgeGraphData() {
  const events = store.events;
  if (!events || events.length === 0) return { nodes: [], edges: [] };

  const entityMap = new Map();
  const topicMap = new Map();
  const entityCooccurrence = new Map();
  const topicEntityCooccurrence = new Map();
  const topicCooccurrence = new Map();

  events.forEach((ev) => {
    const entities = ev.entities || [];
    const topics = ev.topics || [];

    entities.forEach((e) => {
      if (!entityMap.has(e.name)) entityMap.set(e.name, { count: 0, type: e.type });
      entityMap.get(e.name).count++;
    });

    topics.forEach((t) => {
      topicMap.set(t.name, (topicMap.get(t.name) || 0) + 1);
    });

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i].name;
        const b = entities[j].name;
        if (a === b) continue;
        const key = [a, b].sort().join('||');
        entityCooccurrence.set(key, (entityCooccurrence.get(key) || 0) + 1);
      }
    }

    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) {
        const a = topics[i].name;
        const b = topics[j].name;
        if (a === b) continue;
        const key = [a, b].sort().join('||');
        topicCooccurrence.set(key, (topicCooccurrence.get(key) || 0) + 1);
      }
    }

    topics.forEach((t) => {
      entities.forEach((e) => {
        const key = `${t.name}||${e.name}`;
        topicEntityCooccurrence.set(key, (topicEntityCooccurrence.get(key) || 0) + 1);
      });
    });
  });

  const topEntities = Array.from(entityMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, TOP_N_ENTITIES);
  const topEntityNames = new Set(topEntities.map(([name]) => name));

  let topTopics = Array.from(topicMap.entries())
    .filter(([, count]) => count >= MIN_TOPIC_FREQ)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_TOPICS);
  if (topTopics.length < 3) {
    topTopics = Array.from(topicMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }
  const topTopicNames = new Set(topTopics.map(([name]) => name));

  const maxEntityCount = topEntities[0]?.[1].count || 1;
  const maxTopicCount = topTopics[0]?.[1] || 1;

  const entityNodes = topEntities.map(([name, info]) => ({
    id: `entity:${name}`,
    data: {
      label: name,
      count: info.count,
      type: info.type,
      nodeKind: 'entity',
      size: 18 + (info.count / maxEntityCount) * 22,
    },
  }));

  const topicNodes = topTopics.map(([name, count]) => ({
    id: `topic:${name}`,
    data: {
      label: `# ${name}`,
      rawLabel: name,
      count,
      category: classifyTopic(name),
      nodeKind: 'topic',
      size: 16 + (count / maxTopicCount) * 16,
    },
  }));

  const edges = [];

  entityCooccurrence.forEach((count, key) => {
    const [a, b] = key.split('||');
    if (topEntityNames.has(a) && topEntityNames.has(b)) {
      edges.push({
        id: `e2e:${a}-${b}`,
        source: `entity:${a}`,
        target: `entity:${b}`,
        data: { weight: count, kind: 'entity-entity' },
      });
    }
  });

  topicEntityCooccurrence.forEach((count, key) => {
    const [topic, entity] = key.split('||');
    if (topTopicNames.has(topic) && topEntityNames.has(entity)) {
      edges.push({
        id: `t2e:${topic}-${entity}`,
        source: `topic:${topic}`,
        target: `entity:${entity}`,
        data: { weight: count, kind: 'topic-entity' },
      });
    }
  });

  topicCooccurrence.forEach((count, key) => {
    const [a, b] = key.split('||');
    if (topTopicNames.has(a) && topTopicNames.has(b)) {
      edges.push({
        id: `t2t:${a}-${b}`,
        source: `topic:${a}`,
        target: `topic:${b}`,
        data: { weight: count, kind: 'topic-topic' },
      });
    }
  });

  return { nodes: [...entityNodes, ...topicNodes], edges };
}

const graphData = computed(() => buildKnowledgeGraphData());

function getFilteredData() {
  const { nodes, edges } = graphData.value;
  if (viewMode.value === 'entity') {
    return {
      nodes: nodes.filter((n) => n.data.nodeKind === 'entity'),
      edges: edges.filter((e) => e.data.kind === 'entity-entity'),
    };
  }
  if (viewMode.value === 'topic') {
    return {
      nodes: nodes.filter((n) => n.data.nodeKind === 'topic'),
      edges: edges.filter((e) => e.data.kind === 'topic-topic'),
    };
  }
  return {
    nodes,
    edges: edges.filter((e) => e.data.kind !== 'topic-topic'),
  };
}

function isEdgeRelated(d) {
  if (d.data.kind === 'entity-entity') {
    const sourceLabel = d.source.replace('entity:', '');
    const targetLabel = d.target.replace('entity:', '');
    return store.selectedEntity === sourceLabel || store.selectedEntity === targetLabel;
  }
  if (d.data.kind === 'topic-entity') {
    const topicName = d.source.replace('topic:', '');
    const entityName = d.target.replace('entity:', '');
    return store.selectedTopic === topicName || store.selectedEntity === entityName;
  }
  if (d.data.kind === 'topic-topic') {
    const topicA = d.source.replace('topic:', '');
    const topicB = d.target.replace('topic:', '');
    return store.selectedTopic === topicA || store.selectedTopic === topicB;
  }
  return false;
}

async function renderGraph() {
  if (!containerRef.value) return;
  const { nodes, edges } = getFilteredData();

  if (graph) {
    graph.destroy();
    graph = null;
  }

  if (nodes.length === 0) return;

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;

  graph = new Graph({
    container: containerRef.value,
    width,
    height,
    data: { nodes, edges },
    node: {
      style: (d) => {
        const hasAnySel = !!store.selectedEntity || !!store.selectedTopic;

        if (d.data.nodeKind === 'entity') {
          const color = ENTITY_COLORS[d.data.type] || '#8c8c8c';
          const isSelected = store.selectedEntity === d.data.label;
          const isDimmed = hasAnySel && !isSelected;
          return {
            fill: color,
            size: d.data.size,
            labelText: d.data.label,
            labelFill: '#e6e6e6',
            labelFontSize: 11,
            labelPosition: 'bottom',
            labelOffsetY: 4,
            opacity: isDimmed ? 0.2 : 0.9,
            stroke: isSelected ? '#ffffff' : color,
            lineWidth: isSelected ? 3 : 0,
            shadowColor: isSelected ? color : 'transparent',
            shadowBlur: isSelected ? 20 : 0,
          };
        }

        const cat = d.data.category;
        const color = TOPIC_CATEGORIES[cat]?.color || '#8c8c8c';
        const isSelected = store.selectedTopic === d.data.rawLabel;
        const isDimmed = hasAnySel && !isSelected;
        return {
          fill: color,
          size: d.data.size,
          labelText: d.data.label,
          labelFill: '#fff',
          labelFontSize: 11,
          labelPosition: 'top',
          labelOffsetY: -4,
          opacity: isDimmed ? 0.2 : 0.85,
          stroke: isSelected ? '#ffffff' : color,
          lineWidth: isSelected ? 3 : 1,
          shadowColor: isSelected ? color : 'transparent',
          shadowBlur: isSelected ? 20 : 0,
        };
      },
    },
    edge: {
      style: (d) => {
        const related = isEdgeRelated(d);
        const hasAnySel = !!store.selectedEntity || !!store.selectedTopic;
        const highlightColor =
          d.data.kind === 'entity-entity' ? '#4d9eff' :
          d.data.kind === 'topic-entity' ? '#52c41a' : '#b37feb';
        return {
          stroke: related ? highlightColor : '#3a4258',
          lineWidth: 1 + (d.data.weight || 1) * 0.6,
          opacity: hasAnySel ? (related ? 0.8 : 0.08) : 0.4,
        };
      },
    },
    layout: {
      type: 'force',
      preventOverlap: true,
      nodeSize: (d) => d.data.size + 10,
      nodeStrength: -120,
      edgeStrength: 0.04,
      linkDistance: 80,
      gravity: 6,
      maxSpeed: 5,
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
  });

  await graph.render();

  graph.on('node:click', (evt) => {
    const targetId = evt.target?.id;
    if (!targetId) return;
    const nodeData = graph.getElementData(targetId);
    if (!nodeData?.data) return;
    if (nodeData.data.nodeKind === 'entity' && nodeData.data.label) {
      store.selectEntity(nodeData.data.label);
    } else if (nodeData.data.nodeKind === 'topic' && nodeData.data.rawLabel) {
      store.selectTopic(nodeData.data.rawLabel);
    }
  });

  graph.on('node:pointerenter', () => {
    if (containerRef.value) containerRef.value.style.cursor = 'pointer';
  });

  graph.on('node:pointerleave', () => {
    if (containerRef.value) containerRef.value.style.cursor = 'default';
  });
}

onMounted(() => {
  setTimeout(renderGraph, 100);
});

onUnmounted(() => {
  if (graph) graph.destroy();
});

watch(() => store.events, renderGraph);
watch(() => viewMode.value, renderGraph);
watch(() => [store.selectedEntity, store.selectedTopic], () => {
  if (graph) graph.draw();
});

// Legend 只显示当前图里实际存在的类型/类别,避免"有色块但无节点"的混淆
const entityLegendItems = computed(() => {
  const presentTypes = new Set();
  graphData.value.nodes.forEach((n) => {
    if (n.data.nodeKind === 'entity' && n.data.type) {
      presentTypes.add(n.data.type);
    }
  });
  return Object.entries(ENTITY_COLORS)
    .filter(([type]) => presentTypes.has(type))
    .map(([type, color]) => ({ type, color, label: ENTITY_TYPE_LABELS[type] || type }));
});

const topicCategoryItems = computed(() => {
  const presentCats = new Set();
  graphData.value.nodes.forEach((n) => {
    if (n.data.nodeKind === 'topic' && n.data.category) {
      presentCats.add(n.data.category);
    }
  });
  const allCats = [
    ...Object.entries(TOPIC_CATEGORIES).map(([cat, { color }]) => ({ cat, color })),
    { cat: '其他', color: '#8c8c8c' },
  ];
  return allCats.filter((c) => presentCats.has(c.cat));
});

const stats = computed(() => ({
  entityCount: graphData.value.nodes.filter((n) => n.data.nodeKind === 'entity').length,
  topicCount: graphData.value.nodes.filter((n) => n.data.nodeKind === 'topic').length,
}));
</script>

<template>
  <div class="kg-wrapper">
    <div class="kg-toolbar">
      <div class="mode-toggle">
        <button :class="['toggle-btn', { active: viewMode === 'all' }]" @click="viewMode = 'all'">
          全部 ({{ stats.entityCount + stats.topicCount }})
        </button>
        <button :class="['toggle-btn', { active: viewMode === 'entity' }]" @click="viewMode = 'entity'">
          仅实体 ({{ stats.entityCount }})
        </button>
        <button :class="['toggle-btn', { active: viewMode === 'topic' }]" @click="viewMode = 'topic'">
          仅主题 ({{ stats.topicCount }})
        </button>
      </div>
      <div class="filter-status">
        <span v-if="store.selectedEntity" class="badge selected-badge" @click="store.selectEntity(store.selectedEntity)">
          实体: {{ store.selectedEntity }} ✕
        </span>
        <span v-if="store.selectedTopic" class="badge selected-badge" @click="store.selectTopic(store.selectedTopic)">
          主题: {{ store.selectedTopic }} ✕
        </span>
        <button v-if="!props.expanded" class="expand-btn" @click="emit('expand')" title="画中画放大">
          🔍 放大
        </button>
      </div>
    </div>
    <div ref="containerRef" class="kg-graph"></div>
    <div class="legend">
      <div class="legend-row">
        <span class="legend-title">实体(按类型):</span>
        <span v-for="item in entityLegendItems" :key="item.type" class="legend-item">
          <span class="dot" :style="{ background: item.color }"></span>
          {{ item.label }}
        </span>
      </div>
      <div class="legend-row">
        <span class="legend-title">主题(按类别, # 前缀):</span>
        <span v-for="item in topicCategoryItems" :key="item.cat" class="legend-item">
          <span class="dot" :style="{ background: item.color }"></span>
          {{ item.cat }}
        </span>
      </div>
    </div>
    <div class="hint">点击节点筛选事件 · 拖拽节点调整布局 · 滚轮缩放</div>
  </div>
</template>

<style scoped>
.kg-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
}

.kg-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 6px;
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

.filter-status {
  display: flex;
  gap: 6px;
  align-items: center;
}

.expand-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
}

.expand-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(77, 158, 255, 0.06);
}

.selected-badge {
  cursor: pointer;
  background: var(--color-primary);
  color: white;
  font-size: 11px;
}

.kg-graph {
  flex: 1;
  width: 100%;
  min-height: 320px;
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-secondary);
  padding: 4px 0;
}

.legend-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
}

.legend-title {
  font-weight: 600;
  color: var(--color-text);
  margin-right: 2px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.hint {
  font-size: 10px;
  color: var(--color-text-secondary);
  text-align: center;
  padding-top: 2px;
  opacity: 0.7;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: var(--color-border);
}
</style>
