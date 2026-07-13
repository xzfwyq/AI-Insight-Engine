// @ts-check
/**
 * 手写内联 JSON Schema(用于 Anthropic Tool Use)
 *
 * 为什么不用 zod-to-json-schema:
 * zod-to-json-schema 默认生成带 $ref 的 Schema(用 definitions 引用),
 * GLM 兼容协议网关不支持 $ref,会导致 tool_use.input 返回空对象 {}。
 * 手写内联 Schema 完全扁平,无 $ref,所有兼容协议网关都能正确处理。
 *
 * 与 Zod Schema 的关系:
 * - 这个 Schema 用于 LLM Tool Use(告诉模型输出什么格式)
 * - src/schema/event.js 的 Zod Schema 用于运行时校验(验证模型输出是否合法)
 * - 两者保持字段一致,但用途不同
 */

export const EVENT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: '事件唯一标识,格式: sourceType_原始id 的 sha1 哈希前 16 位,例如 "techcrunch_7c7c5a3f"',
    },
    title: {
      type: 'string',
      description: '事件标题,简洁概括',
    },
    summary: {
      type: 'string',
      description: '事件摘要,用中文(无论原文语言),严格控制在 150-250 字之间(硬上限 300 字,超过会被拒绝),客观陈述,不堆砌细节',
    },
    publishedAt: {
      type: 'string',
      description: '发布时间,ISO 8601 格式,例如 "2026-07-10T14:13:00Z"',
    },
    language: {
      type: 'string',
      enum: ['zh', 'en'],
      description: '原文语言',
    },
    source: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '数据源名称,如 "TechCrunch"' },
        url: { type: 'string', description: '原始链接' },
        type: {
          type: 'string',
          enum: ['hf_papers', 'hn', 'devto', 'techcrunch', '36kr', 'zhihu', 'github'],
          description: '数据源类型',
        },
        metadata: {
          type: 'object',
          description: '数据源特有元数据。学术论文填 authors/paperId;HN 填 score/commentsCount;Dev.to 填 reactionsCount/tags/coverImage;GitHub 填 stars/forks/repoLanguage;媒体填 author/category;知乎填 heat/answerCount。不需要的字段可省略。可为空对象 {}。',
          additionalProperties: true,
        },
      },
      required: ['name', 'url', 'type'],
    },
    entities: {
      type: 'array',
      description: '至少抽取 1 个实体。尽量覆盖文中提到的关键实体(公司/产品/技术/人物/论文/仓库等)。不同数据源实体类型不同:学术论文多为 paper/method/dataset/benchmark;GitHub 仓库多为 repository/framework/language;新闻多为 company/product/person。',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '实体名称,用原文出现的名称(英文实体保留英文)' },
          type: {
            type: 'string',
            enum: ['company', 'product', 'technology', 'person', 'organization', 'paper', 'dataset', 'method', 'benchmark', 'repository', 'framework', 'language'],
            description: '实体类型',
          },
          role: {
            type: 'string',
            enum: ['subject', 'object', 'beneficiary', 'context'],
            description: '实体在事件中的角色:subject=主体,object=客体,beneficiary=受益方,context=背景',
          },
        },
        required: ['name', 'type'],
      },
    },
    topics: {
      type: 'array',
      description: '至少 1 个主题标签,反映事件主题,如 "LLM"、"多模态"、"Agent"、"开源模型"、"知识产权" 等',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '主题名称' },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: '置信度 0-1' },
        },
        required: ['name', 'confidence'],
      },
    },
    sentiment: {
      type: 'object',
      description: '情感分析,基于文本整体情感倾向',
      properties: {
        direction: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral'],
          description: '情感方向',
        },
        score: { type: 'number', minimum: -1, maximum: 1, description: '情感分数 -1 到 1' },
      },
      required: ['direction', 'score'],
    },
    impact: {
      type: 'object',
      description: '影响评估。只在文本有明确影响信息时填写,否则省略整个 impact 字段。',
      properties: {
        scope: {
          type: 'string',
          enum: ['industry', 'company', 'research', 'consumer'],
          description: '影响范围:industry=行业级,company=公司级,research=研究级,consumer=消费级',
        },
        timeHorizon: {
          type: 'string',
          enum: ['immediate', 'short-term', 'long-term'],
          description: '时间窗口:immediate=即时,short-term=短期,long-term=长期',
        },
        affectedEntities: {
          type: 'array',
          items: { type: 'string' },
          description: '受影响的实体名称列表',
        },
      },
    },
    rawContent: {
      type: 'string',
      description: '原始内容(摘要/正文/讨论),可选',
    },
    rawContentType: {
      type: 'string',
      enum: ['abstract', 'discussion', 'article', 'readme', 'news'],
      description: '原始内容形态:abstract=论文摘要,discussion=讨论帖,article=文章,readme=README,news=新闻',
    },
  },
  required: ['id', 'title', 'summary', 'publishedAt', 'language', 'source', 'entities', 'topics', 'sentiment'],
};

export const AGGREGATE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    topEvents: {
      type: 'array',
      description: '选出 3-5 个最重要事件,按重要性排序。id 必须从输入数据中复制',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '事件 id(从输入数据复制)' },
          title: { type: 'string', description: '事件标题' },
          significance: { type: 'number', minimum: 0, maximum: 1, description: '重要性 0-1' },
          reason: { type: 'string', description: '入选理由,一句话,引用具体数据' },
        },
        required: ['id', 'title', 'significance', 'reason'],
      },
    },
    headline: {
      type: 'string',
      description: '一句话总结今日 AI 领域最核心的趋势(20-40 字,具体而非空洞,如"AI 开发范式从 Prompt 迁移到 Loop")',
    },
    keyPoints: {
      type: 'array',
      description: '今日 3 个核心要点,每个一句话(30-50 字),必须引用具体事件作为论据',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要点描述,一句话,如"Anthropic 80% 工程师转向自改进循环,Prompt 工程正在消亡"' },
          eventId: { type: 'string', description: '支撑该要点的事件 id(从输入数据复制),用于点击跳转' },
        },
        required: ['text', 'eventId'],
      },
    },
    trends: {
      type: 'array',
      description: '趋势分析,按维度分栏。每栏 2-3 条 bullet,每条 bullet 一句话引用具体事件',
      items: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: ['技术', '应用', '竞争', '资本', '政策'],
            description: '维度分类',
          },
          bullets: {
            type: 'array',
            description: '该维度下的趋势 bullet,2-3 条',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '趋势 bullet,一句话,引用具体事件(如"事件12")' },
                eventId: { type: 'string', description: '相关事件 id(可选,用于跳转)' },
              },
              required: ['text'],
            },
          },
        },
        required: ['dimension', 'bullets'],
      },
    },
    risks: {
      type: 'array',
      description: '风险提示,每条 {title + description + eventId},1-3 条',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '风险标题,10-20 字' },
          description: { type: 'string', description: '风险描述 + 影响范围,30-60 字' },
          eventId: { type: 'string', description: '相关事件 id(可选)' },
        },
        required: ['title', 'description'],
      },
    },
    opportunities: {
      type: 'array',
      description: '机会提示,每条 {title + description + eventId},1-3 条',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '机会标题,10-20 字' },
          description: { type: 'string', description: '机会描述 + 谁能受益,30-60 字' },
          eventId: { type: 'string', description: '相关事件 id(可选)' },
        },
        required: ['title', 'description'],
      },
    },
  },
  required: ['topEvents', 'headline', 'keyPoints', 'trends', 'risks', 'opportunities'],
};

export default EVENT_TOOL_SCHEMA;
