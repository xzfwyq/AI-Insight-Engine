# ADR-005: 从 Tool Use 降级到 JSON 模式

**状态**: Accepted
**日期**: 2026-07-12

## 背景
原计划用 Anthropic Tool Use + `tool_choice: {type: "tool", name: "extract_event"}` 强制 Schema,从 `tool_use.input` 直接取结构化数据(见 ADR-003)。

实际部署时,运行环境使用智谱 GLM-4.7 模型,通过 Anthropic 兼容协议网关访问(`ANTHROPIC_BASE_URL=http://your-gateway-host/public/`,`ANTHROPIC_MODEL=glm-4.7`)。

## 问题诊断

### 现象
Pipeline 跑通后,25 条新闻全部抽取失败,Zod 校验报所有必填字段 `Required`。

### 诊断过程
用 3 种方式调用同一 API 做对比:

| 测试 | 配置 | 结果 |
|---|---|---|
| 测试1 | Tool Use + `tool_choice` 强制 | ❌ `stop_reason: tool_use` 但 `input: {}` 空对象 |
| 测试2 | Tool Use 无强制(让模型自然调用) | ❌ 同上,`input: {}` 空对象 |
| 测试3 | 不用 Tool,让模型直接输出 JSON | ✅ 完美工作,字段完整填充 |

### 根因
GLM 兼容协议网关**形式上**支持 `tool_use`(返回了 `tool_use` block,`stop_reason` 也正确),但模型输出没有正确映射到 `input` 字段——返回的 `input` 始终是空对象 `{}`。这是兼容协议网关的已知问题:网关把 Anthropic 协议的 tool 调用转换成了 GLM 的 function calling,但参数传递环节有 bug。

## 决策
降级到 **JSON 模式**:不用 Tool Use,让模型直接输出 JSON 文本,代码侧 `JSON.parse` + Zod 校验 + 失败重试。

### 关键改动

**extractor.js**:
- 去掉 `tools` 和 `tool_choice` 参数
- System prompt 包含完整 JSON Schema(由 `zodToJsonSchema` 自动生成)
- User message 末尾要求"直接输出 JSON,不要包在代码块里"
- 响应处理:从 `text` block 提取 JSON,兼容 3 种格式:
  1. 纯 JSON(直接 parse)
  2. ` ```json ... ``` ` 代码块(正则提取)
  3. 前后有多余文字(提取第一个 `{` 到最后一个 `}`)
- Zod 校验失败 → 把错误喂回模型重试(最多 2 次)

**aggregator.js**:
- 同样去掉 Tool Use,改成 JSON 模式
- 用户提供 JSON 结构示例在 prompt 里

## 理由

### 为什么不换回原生 Claude API
- 运行环境只提供 GLM 兼容协议网关,无原生 Claude 访问
- 工程现实:面对环境约束,降级而非死磕

### 为什么 JSON 模式是合理降级
- **兼容性广**:所有 Anthropic 兼容协议网关(GLM/Kimi/DeepSeek/Minimax)都支持纯文本输出
- **可控性高**:JSON Schema 在 prompt 里,模型有完整字段定义
- **鲁棒性强**:3 种 JSON 提取策略 + Zod 校验 + 失败重试,容错能力强
- **成本相当**:token 消耗与 Tool Use 相近(JSON Schema 作为 prompt 上下文 vs 作为 tool 定义)

### 保留的工程价值
- **Zod 运行时校验**不变,AI 输出仍受约束
- **失败重试**机制不变,校验失败把错误喂回模型
- **Prompt Caching** 仍可用(system prompt 缓存)
- **Map-Reduce 架构**不变

## 后果
- **优点**:兼容所有 Anthropic 协议网关,不依赖 Tool Use 实现质量
- **缺点**:相比原生 Tool Use,JSON 模式有两点不足:
  1. 模型可能偶尔输出代码块或多余文字(已用 3 种提取策略应对)
  2. 不能利用 `tool_choice` 强制调用(改用 prompt 强约束 + 重试)
- **权衡**:在兼容协议网关环境下,鲁棒性 > 理论优雅性

## 教训
1. **先诊断再决策**:用诊断脚本确认根因,而非盲目改代码
2. **工程现实 > 理论优雅**:面对环境约束快速降级,保证可交付
3. **保留核心价值**:降级不降质,Zod 校验和重试机制保留
4. **记录决策**:ADR 让降级有迹可循,而非"莫名其妙就这么做了"

## 未来扩展
若未来环境支持原生 Anthropic API 或兼容协议网关修复 Tool Use bug,可通过环境变量切换:
```bash
# Tool Use 模式(原生 Claude)
EXTRACTOR_MODE=tool_use

# JSON 模式(默认,兼容协议网关)
EXTRACTOR_MODE=json
```

代码层抽象成策略模式,两种实现共存。当前 MVP 阶段只实现 JSON 模式。
