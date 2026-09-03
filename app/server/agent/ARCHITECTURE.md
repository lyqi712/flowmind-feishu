# 轻量级 Agent 内核架构文档

## 概述

这是一个参考 Claude 能力设计的轻量级 Agent 内核，为 FlowMind 知识库软件提供深度推理和自然对话能力。

## 设计理念

1. **深度理解** - 语义理解、概念推理、关系发现
2. **自然对话** - 避免模板化，动态生成响应
3. **上下文感知** - 滑动窗口记忆，理解对话历史
4. **主动推理** - Chain-of-Thought，多步骤工具编排
5. **自适应执行** - 根据中间结果动态调整计划

## 核心模块

### 1. 意图识别层 (Intent Classifier)

**文件**: `intent-classifier.mjs`

**功能**:
- 快速分类用户意图（知识库/写作/分析/任务/闲聊）
- 基于规则的模式匹配 + 上下文推理
- 提取关键实体（文档引用、时间、操作动词）

**意图类型**:
```javascript
{
  KNOWLEDGE_QUERY: 'knowledge_query',      // 查询知识库
  KNOWLEDGE_UPDATE: 'knowledge_update',    // 更新知识
  WRITING: 'writing',                      // 写作相关
  ANALYSIS: 'analysis',                    // 分析对比
  TASK: 'task',                           // 任务管理
  CHAT: 'chat',                           // 闲聊对话
  CLARIFICATION: 'clarification'          // 需要澄清
}
```

**关键API**:
```javascript
classifyIntent(message, options)
// 返回: { type, confidence, entities, isFollowUp }
```

### 2. 知识推理引擎 (Reasoning Engine)

**文件**: `reasoning-engine.mjs`

**功能**:
- 语义相似度计算
- 概念提取和图谱构建
- 关系推理（找到概念之间的连接路径）
- 对比分析（找出异同）
- 矛盾检测（发现冲突陈述）
- 推理链生成（从前提到结论）
- 深度理解（提取核心论点和证据）
- 知识融合（合并多个来源）

**核心类**:
```javascript
class ReasoningEngine {
  understand(content)              // 深度理解
  compare(entity1, entity2)        // 对比分析
  detectConflicts(statements)      // 矛盾检测
  reason(premise, conclusion)      // 推理链生成
  fuse(sources)                    // 知识融合
  findRelation(concept1, concept2) // 查找关系
}
```

### 3. 工具编排器 (Tool Orchestrator)

**文件**: `tool-orchestrator.mjs`

**功能**:
- Chain-of-Thought 多步骤推理
- 根据意图自动规划工具调用链
- 依赖管理（步骤间的依赖关系）
- 自适应执行（根据中间结果调整计划）
- 条件分支（根据结果决定后续步骤）

**可用工具**:
- `search_knowledge` - 搜索知识库
- `create_document` - 创建文档
- `update_document` - 更新文档
- `analyze_document` - 分析文档
- `compare_documents` - 对比文档
- `detect_contradictions` - 检测矛盾

**核心类**:
```javascript
class ToolOrchestrator {
  async orchestrate(message, options) // 编排执行
  async executePlan(plan)              // 执行计划
}
```

### 4. 对话记忆 (Conversation Memory)

**文件**: `conversation-memory.mjs`

**功能**:
- 滑动窗口（保留最近 10 轮对话）
- 自动压缩（超过阈值时生成摘要）
- 上下文理解（提取关键信息）
- 重要性评分（优先保留重要消息）
- 历史搜索（在对话历史中搜索）
- 导出/导入（持久化支持）

**核心类**:
```javascript
class ConversationMemory {
  addMessage(message)           // 添加消息
  getRecent(count)             // 获取最近消息
  getContext(options)          // 获取带摘要的上下文
  search(query, options)       // 搜索历史
  export() / import(data)      // 持久化
}
```

### 5. 响应生成器 (Response Generator)

**文件**: `response-generator.mjs`

**功能**:
- 自然语言生成（避免固定模板）
- 动态开场白（根据上下文决定是否需要）
- 灵活的内容组织（避免"首先、其次、最后"）
- 自然的追问（主动但不强制）
- 澄清问题生成
- 对比分析生成

**核心类**:
```javascript
class ResponseGenerator {
  generate(data, context)              // 生成完整响应
  generateClarification(message)       // 生成澄清问题
  generateComparison(comparison)       // 生成对比分析
}
```

### 6. Agent 核心 (Agent Core)

**文件**: `core.mjs`

**功能**:
- 整合所有模块
- 完整的消息处理流程
- 流式响应支持
- 会话管理
- 状态跟踪

**核心类**:
```javascript
class AgentCore {
  async processMessage(message, options)  // 处理消息
  async *streamMessage(message, options)  // 流式处理
  getHistory(count)                       // 获取历史
  searchHistory(query, options)           // 搜索历史
  clearConversation()                     // 清空对话
  export() / import(data)                 // 持久化
}
```

## 数据流

```
用户消息
  ↓
[1] 添加到记忆
  ↓
[2] 获取对话上下文
  ↓
[3] 意图识别
  ↓
[4] 是否需要澄清？
  ├─ 是 → 生成澄清问题 → 返回
  └─ 否 → 继续
  ↓
[5] 是否简单闲聊？
  ├─ 是 → 直接回复 → 返回
  └─ 否 → 继续
  ↓
[6] 工具编排（规划执行链）
  ↓
[7] 执行工具链
  ↓
[8] 推理和分析
  ↓
[9] 生成自然语言响应
  ↓
[10] 保存到记忆
  ↓
返回响应
```

## 特色功能

### 1. 深度推理

- **概念图谱**: 自动构建文档中的概念关系
- **推理链**: 从前提到结论的逐步推理
- **矛盾检测**: 自动发现冲突的陈述
- **知识融合**: 合并多个来源的信息

### 2. 自然对话

- **避免模板**: 不使用固定的"首先、其次、最后"
- **动态开场**: 70%的连续对话不需要开场白
- **自然连接**: 使用"，而且"、"同时"等自然连接词
- **适度追问**: 只在有价值时提出后续问题

### 3. 上下文理解

- **滑动窗口**: 保留最近 10 轮对话
- **智能压缩**: 自动生成摘要，节省 token
- **重要性评分**: 优先保留重要消息
- **关键信息提取**: 自动提取用户偏好、重要事实、决策

### 4. 自适应执行

- **动态调整**: 根据中间结果调整后续计划
- **扩展查询**: 搜索无结果时自动扩展查询词
- **条件分支**: 根据搜索结果决定创建或更新

## 性能优化

1. **快速意图识别**: 基于规则的模式匹配，毫秒级响应
2. **延迟推理**: 只在需要时构建概念图谱
3. **增量压缩**: 对话记忆自动压缩，避免膨胀
4. **并行执行**: 工具编排支持独立步骤并行

## 可扩展性

### 添加新意图类型

```javascript
// intent-classifier.mjs
export const INTENT_TYPES = Object.freeze({
  // ... 现有类型
  NEW_INTENT: 'new_intent'
});

const INTENT_PATTERNS = {
  [INTENT_TYPES.NEW_INTENT]: [
    /pattern1/u,
    /pattern2/u
  ]
};
```

### 添加新工具

```javascript
// tool-orchestrator.mjs
const AVAILABLE_TOOLS = {
  new_tool: {
    name: 'new_tool',
    description: '工具描述',
    parameters: ['param1', 'param2'],
    execute: async (params, context) => {
      // 实现逻辑
      return result;
    }
  }
};
```

### 自定义推理逻辑

```javascript
// reasoning-engine.mjs
class ReasoningEngine {
  customReasoning(input) {
    // 自定义推理逻辑
  }
}
```

## 与现有系统集成

### 1. 知识库集成

```javascript
const agent = new AgentCore();

// 设置知识库文档
agent.setDocuments(documents);

// 设置搜索函数
agent.orchestrator.setContext({
  knowledgeSearch: async (query, limit) => {
    // 调用现有的知识库搜索
    return await searchKnowledgeBase(query, limit);
  }
});
```

### 2. 对话接口集成

```javascript
// REST API
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  
  // 恢复会话
  const agent = getOrCreateAgent(sessionId);
  
  // 处理消息
  const response = await agent.processMessage(message);
  
  res.json(response);
});

// WebSocket (流式)
ws.on('message', async (message) => {
  const agent = getOrCreateAgent(ws.sessionId);
  
  for await (const chunk of agent.streamMessage(message)) {
    ws.send(JSON.stringify(chunk));
  }
});
```

### 3. 持久化

```javascript
// 保存会话
const sessionData = agent.export();
await saveToDatabase(sessionId, sessionData);

// 恢复会话
const sessionData = await loadFromDatabase(sessionId);
agent.import(sessionData);
```

## 配置选项

```javascript
const agent = new AgentCore({
  // 记忆配置
  memory: {
    windowSize: 10,           // 滑动窗口大小
    summaryThreshold: 20      // 自动摘要阈值
  },
  
  // 推理配置
  reasoning: {
    maxDepth: 3,              // 最大推理深度
    confidenceThreshold: 0.6  // 置信度阈值
  },
  
  // 响应配置
  response: {
    naturalness: 0.8,         // 自然度 (0-1)
    conciseness: 0.7          // 简洁度 (0-1)
  },
  
  // 工具配置
  tools: {
    adaptiveMode: true        // 自适应执行
  }
});
```

## 调试和监控

### 启用详细日志

```javascript
const agent = new AgentCore({
  debug: true,
  logger: console
});
```

### 获取统计信息

```javascript
const stats = agent.getStats();
console.log(stats);
// {
//   memory: { totalMessages, currentMessages, ... },
//   state: { lastIntent, ... },
//   contextDocuments: 10
// }
```

### 查看推理过程

```javascript
const response = await agent.processMessage(message);
console.log(response.reasoning);
// [
//   { step: 1, action: 'search_knowledge', reason: '...' },
//   { step: 2, action: 'analyze_document', reason: '...' }
// ]
```

## 错误处理

Agent 内核内置了完整的错误处理：

1. **工具执行失败**: 自动跳过可选步骤，终止必需步骤
2. **意图识别失败**: 降级为知识查询意图
3. **响应生成失败**: 返回友好的错误提示
4. **记忆溢出**: 自动压缩和摘要

## 未来改进方向

1. **向量化**: 使用 embedding 模型提升语义理解
2. **多模态**: 支持图片、音频输入
3. **并行推理**: 多个推理引擎并行工作
4. **强化学习**: 根据用户反馈优化响应策略
5. **插件系统**: 支持第三方工具和推理模块

## 参考

- Claude 对话能力
- Chain-of-Thought 推理
- Retrieval-Augmented Generation (RAG)
- Memory Networks
