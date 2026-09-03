# Agent 内核 API 参考

## 核心类

### AgentCore

主 Agent 类，整合所有功能模块。

#### 构造函数

```javascript
new AgentCore(options)
```

**参数**:
- `options` (Object, 可选) - 配置选项
  - `memory` (Object) - 记忆配置
    - `windowSize` (Number) - 滑动窗口大小，默认 10
    - `summaryThreshold` (Number) - 自动摘要阈值，默认 20
  - `reasoning` (Object) - 推理配置
    - `maxDepth` (Number) - 最大推理深度，默认 3
    - `confidenceThreshold` (Number) - 置信度阈值，默认 0.6
  - `response` (Object) - 响应配置
    - `naturalness` (Number) - 自然度 0-1，默认 0.8
    - `conciseness` (Number) - 简洁度 0-1，默认 0.7
  - `tools` (Object) - 工具配置
    - `adaptiveMode` (Boolean) - 自适应执行，默认 true

**返回**: AgentCore 实例

---

#### setDocuments(documents)

设置知识库文档，用于推理和检索。

**参数**:
- `documents` (Array) - 文档数组
  - `id` (String) - 文档 ID
  - `title` (String) - 文档标题
  - `content` (String) - 文档内容
  - `url` (String, 可选) - 文档 URL

**返回**: void

**示例**:
```javascript
agent.setDocuments([
  {
    id: 'doc1',
    title: 'AI 概述',
    content: 'AI 是...',
    url: 'https://example.com/doc1'
  }
]);
```

---

#### setUserPreferences(preferences)

设置用户偏好，用于个性化响应。

**参数**:
- `preferences` (Array<String>) - 用户偏好数组

**返回**: void

**示例**:
```javascript
agent.setUserPreferences([
  '我喜欢简洁的回答',
  '关注技术细节'
]);
```

---

#### processMessage(message, options)

处理用户消息，返回完整响应。

**参数**:
- `message` (String) - 用户消息
- `options` (Object, 可选) - 处理选项

**返回**: Promise<Response>

**Response 对象**:
```javascript
{
  type: String,              // 响应类型: knowledge_query/analysis/writing/chat/error
  content: String,           // 响应内容
  intent: {                  // 意图识别结果
    type: String,
    confidence: Number,
    entities: Object,
    isFollowUp: Boolean
  },
  sources: Array,            // 引用来源（如果有）
  reasoning: Array,          // 推理步骤
  processingTime: Number,    // 处理耗时(ms)
  memoryStats: Object        // 记忆统计
}
```

**示例**:
```javascript
const response = await agent.processMessage('什么是机器学习？');
console.log(response.content);
console.log(response.intent.type); // 'knowledge_query'
```

---

#### streamMessage(message, options)

流式处理消息，逐步返回中间结果。

**参数**:
- `message` (String) - 用户消息
- `options` (Object, 可选) - 处理选项

**返回**: AsyncGenerator<Chunk>

**Chunk 类型**:
```javascript
{
  type: 'intent' | 'plan' | 'step' | 'response',
  data: Object
}
```

**示例**:
```javascript
for await (const chunk of agent.streamMessage('分析一下')) {
  switch (chunk.type) {
    case 'intent':
      console.log('意图:', chunk.data);
      break;
    case 'plan':
      console.log('计划:', chunk.data);
      break;
    case 'step':
      console.log('步骤:', chunk.data);
      break;
    case 'response':
      console.log('响应:', chunk.data);
      break;
  }
}
```

---

#### getHistory(count)

获取对话历史。

**参数**:
- `count` (Number, 可选) - 返回消息数量，默认全部

**返回**: Array<Message>

**Message 对象**:
```javascript
{
  role: 'user' | 'assistant',
  content: String,
  timestamp: Number,
  metadata: Object
}
```

**示例**:
```javascript
const recent5 = agent.getHistory(5);
recent5.forEach(msg => {
  console.log(`${msg.role}: ${msg.content}`);
});
```

---

#### searchHistory(query, options)

在对话历史中搜索。

**参数**:
- `query` (String) - 搜索关键词
- `options` (Object, 可选)
  - `role` (String) - 角色过滤: 'user' | 'assistant'
  - `limit` (Number) - 返回数量，默认 10
  - `minScore` (Number) - 最小相似度分数，默认 0.3

**返回**: Array<SearchResult>

**SearchResult 对象**:
```javascript
{
  message: Message,
  score: Number,    // 相似度分数 0-1
  index: Number     // 在历史中的位置
}
```

**示例**:
```javascript
const results = agent.searchHistory('机器学习', {
  role: 'user',
  limit: 5
});
```

---

#### clearConversation()

清空当前对话。

**返回**: void

---

#### getStats()

获取统计信息。

**返回**: Object

```javascript
{
  memory: {
    totalMessages: Number,
    currentMessages: Number,
    summaryCount: Number,
    durationMs: Number,
    durationMinutes: Number,
    userMessages: Number,
    assistantMessages: Number,
    avgMessageLength: Number
  },
  state: {
    isReady: Boolean,
    lastIntent: String,
    conversationId: String
  },
  contextDocuments: Number
}
```

---

#### export()

导出会话数据（用于持久化）。

**返回**: Object

```javascript
{
  memory: Object,
  context: Object,
  state: Object,
  config: Object
}
```

---

#### import(data)

导入会话数据（从持久化恢复）。

**参数**:
- `data` (Object) - 导出的会话数据

**返回**: void

---

## 工具函数

### 意图识别

#### classifyIntent(message, options)

识别用户意图。

**参数**:
- `message` (String | Object) - 用户消息
- `options` (Object, 可选)
  - `context` (Object) - 上下文信息
  - `returnDetails` (Boolean) - 是否返回详细信息

**返回**: Object

```javascript
{
  type: String,           // 意图类型
  confidence: Number,     // 置信度 0-1
  entities: Object,       // 提取的实体（可选）
  isFollowUp: Boolean     // 是否追问（可选）
}
```

---

#### INTENT_TYPES

意图类型常量。

```javascript
{
  KNOWLEDGE_QUERY: 'knowledge_query',
  KNOWLEDGE_UPDATE: 'knowledge_update',
  WRITING: 'writing',
  ANALYSIS: 'analysis',
  TASK: 'task',
  CHAT: 'chat',
  CLARIFICATION: 'clarification'
}
```

---

### 推理引擎

#### ReasoningEngine

推理引擎类。

**构造函数**:
```javascript
new ReasoningEngine(options)
```

**参数**:
- `options` (Object, 可选)
  - `documents` (Array) - 初始文档

---

##### understand(content)

深度理解内容。

**参数**:
- `content` (String) - 待理解内容

**返回**: Object

```javascript
{
  claims: Array,        // 观点
  evidence: Array,      // 证据
  concepts: Array,      // 关键概念
  mainTopic: String,    // 主题
  complexity: String    // 复杂度: low/medium/high
}
```

---

##### compare(entity1, entity2)

对比两个实体。

**参数**:
- `entity1` (Object | String) - 实体1
- `entity2` (Object | String) - 实体2

**返回**: Object

```javascript
{
  similarities: Array,        // 相似点
  differences: {
    onlyInFirst: Array,      // 仅在实体1中
    onlyInSecond: Array      // 仅在实体2中
  },
  similarity: Number          // 相似度 0-1
}
```

---

##### detectConflicts(statements)

检测矛盾。

**参数**:
- `statements` (Array) - 陈述数组

**返回**: Array<Contradiction>

```javascript
[
  {
    statement1: Object,
    statement2: Object,
    type: String,
    confidence: Number
  }
]
```

---

##### reason(premise, conclusion)

生成推理链。

**参数**:
- `premise` (String) - 前提
- `conclusion` (String) - 结论

**返回**: Object

```javascript
{
  steps: Array,           // 推理步骤
  confidence: Number      // 整体置信度
}
```

---

##### fuse(sources)

融合知识。

**参数**:
- `sources` (Array) - 知识来源

**返回**: Object

```javascript
{
  concepts: Array,
  claims: Array,
  evidence: Array,
  contradictions: Array,
  sourceCount: Number,
  hasConflict: Boolean
}
```

---

### 工具编排器

#### ToolOrchestrator

工具编排器类。

**构造函数**:
```javascript
new ToolOrchestrator(options)
```

**参数**:
- `options` (Object, 可选)
  - `context` (Object) - 上下文
  - `adaptiveMode` (Boolean) - 自适应模式

---

##### orchestrate(message, options)

编排并执行工具链。

**参数**:
- `message` (Object) - 用户消息
- `options` (Object, 可选)
  - `intent` (Object) - 意图识别结果
  - `context` (Object) - 上下文

**返回**: Promise<Object>

```javascript
{
  intent: Object,
  plan: Object,
  execution: Object,
  adaptiveMode: Boolean
}
```

---

### 对话记忆

#### ConversationMemory

对话记忆管理器。

**构造函数**:
```javascript
new ConversationMemory(options)
```

**参数**:
- `options` (Object, 可选)
  - `windowSize` (Number) - 窗口大小
  - `summaryThreshold` (Number) - 摘要阈值

---

##### addMessage(message)

添加消息到记忆。

**参数**:
- `message` (Object)
  - `role` (String) - 角色
  - `content` (String) - 内容
  - `timestamp` (Number, 可选) - 时间戳
  - `metadata` (Object, 可选) - 元数据

**返回**: Object - 标准化的消息对象

---

##### getRecent(count)

获取最近消息。

**参数**:
- `count` (Number, 可选) - 数量

**返回**: Array<Message>

---

##### getContext(options)

获取上下文（带摘要）。

**参数**:
- `options` (Object, 可选)
  - `includeHistory` (Boolean) - 包含历史
  - `maxTokens` (Number) - 最大 token 数
  - `minRecent` (Number) - 最少保留消息数

**返回**: Object

```javascript
{
  recent: Array,          // 最近消息
  summary: Object,        // 对话摘要
  totalMessages: Number,  // 总消息数
  keyInfo: Object         // 关键信息
}
```

---

### 响应生成器

#### ResponseGenerator

响应生成器类。

**构造函数**:
```javascript
new ResponseGenerator(options)
```

**参数**:
- `options` (Object, 可选)
  - `naturalness` (Number) - 自然度 0-1
  - `conciseness` (Number) - 简洁度 0-1

---

##### generate(data, context)

生成响应。

**参数**:
- `data` (Object)
  - `intent` (String) - 意图类型
  - `content` (Array) - 内容数组
  - `sources` (Array, 可选) - 来源
  - `isFollowUp` (Boolean, 可选) - 是否追问
  - `hasMoreInfo` (Boolean, 可选) - 是否有更多信息
  - `isComplete` (Boolean, 可选) - 是否完整
- `context` (Object, 可选) - 上下文

**返回**: String - 生成的响应文本

---

##### generateClarification(message, context)

生成澄清问题。

**参数**:
- `message` (String | Object) - 用户消息
- `context` (Object, 可选) - 上下文

**返回**: Object | null

```javascript
{
  type: 'clarification',
  content: String,
  missingInfo: Array
}
```

---

##### generateComparison(comparison, context)

生成对比分析。

**参数**:
- `comparison` (Object) - 对比结果
- `context` (Object, 可选) - 上下文

**返回**: String - 对比分析文本

---

## 类型定义

### Message

```typescript
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: {
    intent?: string;
    confidence?: number;
    sources?: any[];
    [key: string]: any;
  };
}
```

### Intent

```typescript
interface Intent {
  type: string;
  confidence: number;
  entities?: {
    documentMentions: string[];
    timeReferences: string[];
    actions: string[];
    hasQuestionMark: boolean;
    length: number;
  };
  isFollowUp?: boolean;
}
```

### Response

```typescript
interface Response {
  type: string;
  content: string;
  intent: Intent;
  sources?: any[];
  reasoning?: ReasoningStep[];
  processingTime: number;
  memoryStats?: MemoryStats;
  [key: string]: any;
}
```

### ReasoningStep

```typescript
interface ReasoningStep {
  step: number;
  action: string;
  reason: string;
}
```

### MemoryStats

```typescript
interface MemoryStats {
  totalMessages: number;
  currentMessages: number;
  summaryCount: number;
  durationMs: number;
  durationMinutes: number;
  userMessages: number;
  assistantMessages: number;
  avgMessageLength: number;
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| INTENT_UNKNOWN | 无法识别意图 |
| TOOL_NOT_FOUND | 工具未找到 |
| TOOL_EXECUTION_FAILED | 工具执行失败 |
| DEPENDENCY_NOT_MET | 依赖条件未满足 |
| CONTEXT_REQUIRED | 缺少必需上下文 |
| MEMORY_OVERFLOW | 记忆溢出 |

---

## 事件

Agent 支持以下事件监听（可选）：

```javascript
agent.on('message:received', (message) => {
  console.log('收到消息:', message);
});

agent.on('intent:classified', (intent) => {
  console.log('意图识别:', intent);
});

agent.on('tool:executed', (tool, result) => {
  console.log('工具执行:', tool, result);
});

agent.on('response:generated', (response) => {
  console.log('响应生成:', response);
});

agent.on('error', (error) => {
  console.error('错误:', error);
});
```

---

## 配置优先级

1. 运行时传入的参数（最高）
2. 构造函数配置
3. 默认配置（最低）

---

## 性能建议

1. **批量操作**: 使用 `addMessages` 而不是多次 `addMessage`
2. **按需推理**: 只在需要时调用推理引擎
3. **缓存文档**: 避免重复调用 `setDocuments`
4. **定期清理**: 长时间运行时定期清理不活跃会话
5. **流式响应**: 大量数据时使用 `streamMessage`

---

## 兼容性

- Node.js >= 16.0.0
- 支持 ES Modules
- 无需额外的编译步骤
