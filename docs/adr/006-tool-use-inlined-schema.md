# ADR-006: Tool Use + 手写内联 Schema(放弃 zod-to-json-schema)

**状态**: Accepted
**日期**: 2026-07-12
**替代**: ADR-005(从 JSON 模式回归 Tool Use)

## 背景
ADR-005 记录了从 Tool Use 降级到 JSON 模式的决策,原因是 GLM 兼容协议网关 `tool_use.input` 返回空 `{}`。但降级方案缺乏技术亮点(JSON 模式是 2020 年的做法,Tool Use 才是 2025-2026 年的正确方式)。

## 问题重新诊断

### 诊断过程
用 3 种 Schema 测试同一 API:
| 测试 | Schema | 结果 |
|---|---|---|
| 测试1 | 极简 Schema(2 字段,无嵌套) | ✅ `input` 完整 |
| 测试2 | 完整 EventSchema(经 zod-to-json-schema) | ❌ `input: {}` |
| 测试3 | 完整 Schema + thinking budget | ❌ `input: {}` |

### 根因定位
不是网关 bug,是 **Schema 格式问题**:
- `zod-to-json-schema` 默认生成带 `$ref` 的 Schema(用 `definitions` 引用)
- 完整 EventSchema 经转换后:`{"$ref":"#/definitions/extract_event","definitions":{...}}`
- GLM 兼容协议网关**不支持 `$ref` 引用**,解析 Schema 时无法定位到实际字段定义
- 导致模型看到的 tool schema 是空的,所以 `input` 也返回空

## 决策
**回归 Tool Use,但改用手写内联 JSON Schema(无 `$ref`)**。

### 关键改动

**新增 `src/schema/event-tool-schema.js`**:
- 手写完全扁平的 JSON Schema,无任何 `$ref`/`definitions`
- 字段与 Zod Schema 保持一致(用途不同)
- 所有 enum 和 description 完整内联

**extractor.js 改回 Tool Use**:
- `input_schema` 用 `EVENT_TOOL_SCHEMA`(手写内联)
- 保留 `tool_choice: {type: "tool", name: "extract_event"}` 强制调用
- 保留 Zod 运行时校验 + 失败重试(双重保障)

**aggregator.js 改回 Tool Use**:
- `AGGREGATE_TOOL_SCHEMA` 同样手写内联
- 保留 `tool_choice` 强制 + Zod 校验

## 理由

### 为什么不用 zod-to-json-schema 的 $refStrategy: 'none'
- 实测该参数在当前版本不生效,仍生成 `$ref`
- 即使生效,生成的 Schema 仍有兼容性风险

### 为什么手写而非自动转换
- 手写 Schema 完全可控,字段定义清晰
- 可以为每个字段写详细 description(指导模型抽取)
- 避免 zod-to-json-schema 的各种边界情况
- LLM Tool Use 的 Schema 本质是给模型看的"合同",手写更直观

### 为什么保留 Zod Schema
- **双重保障**:手写 JSON Schema 给模型看 → Zod Schema 给代码校验
- Zod 的 `safeParse` 返回详细错误,便于失败重试时喂回模型
- 两个 Schema 字段一致,但用途不同(一个对 LLM,一个对运行时)

## 验证结果

进一步验证手写内联 Schema:
- ✅ 手写内联 Schema(1925 字符,无 `$ref`)
- ✅ `tool_use.input` 完整返回所有字段
- ✅ entities/topics/sentiment/impact 全部正确填充
- ✅ 中文 summary、英文实体名都正确

## 后果
- **优点**:回归 2025-2026 年正确的 Tool Use 方式,有技术深度
- **优点**:双重 Schema(LLM + 运行时)展示工程严谨
- **缺点**:两个 Schema 需要保持同步(字段变更时两处都改)
- **权衡**:用一点重复换取兼容性和可控性,值得

## 教训
1. **不要轻易降级**:首次诊断不够深入,误判为网关 bug 就降级。深入诊断后发现是 Schema 格式问题
2. **诊断脚本的价值**:用最小复现案例(极简 Schema vs 完整 Schema)对比,快速定位根因
3. **$ref 兼容性**:JSON Schema 的 `$ref` 虽是标准,但许多 LLM 网关不完全支持,手写内联更稳
4. **双重 Schema 的价值**:LLM 看的 Schema 和运行时校验的 Schema 分离,各司其职

## 取代 ADR-005
ADR-005 的 JSON 模式降级方案作废,extractor 和 aggregator 均回归 Tool Use。
