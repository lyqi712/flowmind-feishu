# Agent 内核使用示例

## 基础用法

### 1. 初始化 Agent

```javascript
import { AgentCore } from './server/agent/core.mjs';

// 创建 Agent 实例
const agent = new AgentCore({
  memory: {
    windowSize: 10,
    summaryThreshold: 20
  },
  response: {
    naturalness: 0.8,
    conciseness: 0.7
  }
});

// 设置知识库文档
const documents = [
  {
    id: 'doc1',
    title: 'AI 技术概述',
    content: 'AI 是人工智能的缩写，包括机器学习、深度学习等...',
    url: 'https://example.com/doc1'
  },
  {
    id: 'doc2',
    title: '知识图谱简介',
    content: '知识图谱是一种语义网络，用于表示实体之间的关系...',
    url: 'https://example.com/doc2'
  }
];

agent.setDocuments(documents);

// 设置用户偏好
agent.setUserPreferences([
  '我喜欢简洁的回答',
  '关注技术细节'
]);
```

### 2. 简单对话

```javascript
// 处理用户消息
const response = await agent.processMessage('什么是AI？');

console.log(response.content);
// "AI 是人工智能的缩写，包括机器学习、深度学习等技术领域。[1]"

console.log(response.intent);
// { type: 'knowledge_query', confidence: 0.85 }

console.log(response.sources);
// [{ id: 'doc1', title: 'AI 技术概述', ... }]
```

### 3. 连续对话

```javascript
// 第一轮
await agent.processMessage('什么是知识图谱？');

// 第二轮（上下文相关）
const response = await agent.processMessage('它和 AI 有什么关系？');

console.log(response.content);
// "知识图谱在 AI 中常用于知识表示和推理。两者结合可以..."
```

## 高级用法

### 4. 对比分析

```javascript
const response = await agent.processMessage(
  '对比一下机器学习和深度学习的区别'
);

console.log(response.type);
// "analysis"

console.log(response.content);
// "相同点在于都是AI的子领域。不同的是，机器学习涵盖更广，
//  而深度学习专注于神经网络。"

console.log(response.analysisData);
// {
//   similarities: ['AI的子领域', ...],
//   differences: {
//     onlyInFirst: [...],
//     onlyInSecond: [...]
//   }
// }
```

### 5. 写作辅助

```javascript
const response = await agent.processMessage(
  '帮我写一篇关于知识图谱的介绍'
);

console.log(response.type);
// "writing"

console.log(response.content);
// "关键概念：知识图谱、语义网络、实体关系...
//  知识图谱是一种结构化的知识表示方式..."

console.log(response.writingData);
// {
//   concepts: [{ text: '知识图谱', ... }],
//   claims: [...],
//   evidence: [...]
// }
```

### 6. 澄清模式

```javascript
const response = await agent.processMessage('帮我分析一下');

console.log(response.type);
// "clarification"

console.log(response.content);
// "具体想要分析什么？"

console.log(response.missingInfo);
// ['reference']
```

### 7. 流式响应

```javascript
// 适用于实时展示
for await (const chunk of agent.streamMessage('什么是机器学习？')) {
  switch (chunk.type) {
    case 'intent':
      console.log('识别意图:', chunk.data);
      break;
    
    case 'plan':
      console.log('执行计划:', chunk.data);
      break;
    
    case 'step':
      console.log('执行步骤:', chunk.data);
      break;
    
    case 'response':
      console.log('最终响应:', chunk.data);
      break;
  }
}
```

## 会话管理

### 8. 查看对话历史

```javascript
// 获取最近 5 轮对话
const history = agent.getHistory(5);

console.log(history);
// [
//   { role: 'user', content: '什么是AI？', timestamp: ... },
//   { role: 'assistant', content: 'AI 是...', timestamp: ... },
//   ...
// ]
```

### 9. 搜索历史对话

```javascript
// 搜索包含"机器学习"的对话
const results = agent.searchHistory('机器学习', {
  role: 'user',  // 只搜索用户消息
  limit: 5
});

console.log(results);
// [
//   {
//     message: { role: 'user', content: '什么是机器学习？' },
//     score: 0.8,
//     index: 3
//   },
//   ...
// ]
```

### 10. 清空对话

```javascript
// 开始新对话
agent.clearConversation();

const stats = agent.getStats();
console.log(stats.memory.totalMessages); // 0
```

## 持久化

### 11. 导出会话

```javascript
// 导出会话数据
const sessionData = agent.export();

// 保存到数据库或文件
await saveToDatabase('session-123', sessionData);

// 或者保存为 JSON
import { writeFile } from 'fs/promises';
await writeFile('session.json', JSON.stringify(sessionData, null, 2));
```

### 12. 恢复会话

```javascript
// 从数据库加载
const sessionData = await loadFromDatabase('session-123');

// 或者从文件加载
import { readFile } from 'fs/promises';
const sessionData = JSON.parse(await readFile('session.json', 'utf-8'));

// 恢复会话
agent.import(sessionData);

// 继续对话
const response = await agent.processMessage('继续刚才的话题');
```

## 与现有系统集成

### 13. Express 服务器集成

```javascript
import express from 'express';
import { AgentCore } from './server/agent/core.mjs';

const app = express();
app.use(express.json());

// 会话管理
const sessions = new Map();

function getOrCreateAgent(sessionId) {
  if (!sessions.has(sessionId)) {
    const agent = new AgentCore();
    agent.setDocuments(loadDocuments());
    sessions.set(sessionId, agent);
  }
  return sessions.get(sessionId);
}

// 对话接口
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    const agent = getOrCreateAgent(sessionId);
    const response = await agent.processMessage(message);
    
    res.json({
      success: true,
      response: response.content,
      intent: response.intent,
      sources: response.sources,
      processingTime: response.processingTime
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取历史
app.get('/api/history/:sessionId', (req, res) => {
  const agent = sessions.get(req.params.sessionId);
  if (!agent) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    history: agent.getHistory(),
    stats: agent.getStats()
  });
});

// 清空对话
app.delete('/api/session/:sessionId', (req, res) => {
  const agent = sessions.get(req.params.sessionId);
  if (agent) {
    agent.clearConversation();
  }
  sessions.delete(req.params.sessionId);
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('Agent server running on port 3000');
});
```

### 14. WebSocket 流式集成

```javascript
import WebSocket from 'ws';

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  const sessionId = generateSessionId();
  const agent = new AgentCore();
  agent.setDocuments(loadDocuments());
  
  ws.on('message', async (data) => {
    try {
      const { type, payload } = JSON.parse(data);
      
      if (type === 'message') {
        // 流式响应
        for await (const chunk of agent.streamMessage(payload.content)) {
          ws.send(JSON.stringify({
            type: 'stream',
            data: chunk
          }));
        }
        
        ws.send(JSON.stringify({
          type: 'done'
        }));
      }
      
      if (type === 'history') {
        ws.send(JSON.stringify({
          type: 'history',
          data: agent.getHistory()
        }));
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });
});
```

### 15. 自定义工具集成

```javascript
import { AgentCore } from './server/agent/core.mjs';

const agent = new AgentCore();

// 设置自定义上下文
agent.orchestrator.setContext({
  // 知识库搜索
  knowledgeSearch: async (query, limit) => {
    const results = await yourSearchAPI(query, limit);
    return results.map(r => ({
      id: r.id,
      title: r.title,
      excerpt: r.snippet,
      document: {
        title: r.title,
        url: r.url
      }
    }));
  },
  
  // 获取文档
  getDocument: (documentId) => {
    return yourDocumentStore.get(documentId);
  },
  
  // 创建文档
  createDocument: async (params) => {
    const doc = await yourDocumentStore.create({
      title: params.title,
      content: params.content,
      tags: params.tags
    });
    return { id: doc.id, created: true };
  },
  
  // 更新文档
  updateDocument: async (documentId, updates) => {
    await yourDocumentStore.update(documentId, updates);
    return { updated: true };
  },
  
  // 所有文档（用于推理）
  documents: await yourDocumentStore.getAll()
});
```

## 测试示例

### 16. 单元测试

```javascript
import { describe, it, expect } from 'vitest';
import { classifyIntent, INTENT_TYPES } from './server/agent/intent-classifier.mjs';

describe('Intent Classifier', () => {
  it('should classify knowledge query', () => {
    const result = classifyIntent('什么是机器学习？');
    expect(result.type).toBe(INTENT_TYPES.KNOWLEDGE_QUERY);
    expect(result.confidence).toBeGreaterThan(0.6);
  });
  
  it('should classify writing intent', () => {
    const result = classifyIntent('帮我写一篇关于AI的文章');
    expect(result.type).toBe(INTENT_TYPES.WRITING);
  });
  
  it('should detect chat', () => {
    const result = classifyIntent('你好');
    expect(result.type).toBe(INTENT_TYPES.CHAT);
  });
});
```

### 17. 集成测试

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentCore } from './server/agent/core.mjs';

describe('Agent Core', () => {
  let agent;
  
  beforeEach(() => {
    agent = new AgentCore();
    agent.setDocuments([
      {
        id: 'test-doc',
        title: 'Test Document',
        content: '机器学习是AI的一个分支，专注于让计算机从数据中学习。'
      }
    ]);
  });
  
  it('should process simple query', async () => {
    const response = await agent.processMessage('什么是机器学习？');
    
    expect(response.type).toBe('knowledge_query');
    expect(response.content).toContain('机器学习');
    expect(response.sources).toHaveLength(1);
    expect(response.processingTime).toBeGreaterThan(0);
  });
  
  it('should maintain conversation context', async () => {
    await agent.processMessage('什么是机器学习？');
    const response = await agent.processMessage('它的应用有哪些？');
    
    expect(response.intent.isFollowUp).toBe(true);
  });
  
  it('should export and import session', async () => {
    await agent.processMessage('测试消息');
    
    const exported = agent.export();
    expect(exported.memory.messages).toHaveLength(2); // user + assistant
    
    const newAgent = new AgentCore();
    newAgent.import(exported);
    
    const history = newAgent.getHistory();
    expect(history).toHaveLength(2);
  });
});
```

## 性能监控

### 18. 获取统计信息

```javascript
const stats = agent.getStats();

console.log(stats);
// {
//   memory: {
//     totalMessages: 20,
//     currentMessages: 10,
//     summaryCount: 1,
//     durationMinutes: 15,
//     userMessages: 10,
//     assistantMessages: 10,
//     avgMessageLength: 85
//   },
//   state: {
//     isReady: true,
//     lastIntent: 'knowledge_query',
//     conversationId: null
//   },
//   contextDocuments: 50
// }
```

### 19. 调试推理过程

```javascript
const response = await agent.processMessage('对比机器学习和深度学习');

// 查看推理步骤
console.log('推理过程:');
response.reasoning.forEach(step => {
  console.log(`${step.step}. ${step.action} - ${step.reason}`);
});

// 输出:
// 1. search_knowledge - 找到待分析的对象
// 2. analyze_document - 进行深度分析
// 3. detect_contradictions - 检测信息中的矛盾

// 查看处理时间
console.log(`处理耗时: ${response.processingTime}ms`);
```

## 错误处理

### 20. 捕获和处理错误

```javascript
try {
  const response = await agent.processMessage(userMessage);
  
  if (response.type === 'error') {
    console.error('Agent 错误:', response.error);
    // 显示友好的错误提示给用户
    showToUser(response.content);
  } else {
    // 正常处理响应
    displayResponse(response.content);
  }
} catch (error) {
  console.error('严重错误:', error);
  showToUser('抱歉，系统出现了问题，请稍后重试。');
}
```

## 最佳实践

1. **会话管理**: 为每个用户维护独立的 Agent 实例
2. **定期持久化**: 每 5-10 轮对话保存一次会话数据
3. **资源清理**: 长时间不活动的会话应该清理
4. **错误恢复**: 捕获错误并提供友好的降级体验
5. **性能监控**: 定期检查处理时间和内存使用
6. **逐步增强**: 先实现基础功能，再添加高级推理

## 配置建议

### 对话型应用
```javascript
new AgentCore({
  memory: { windowSize: 10 },
  response: { naturalness: 0.9, conciseness: 0.6 }
});
```

### 专业分析工具
```javascript
new AgentCore({
  memory: { windowSize: 15 },
  reasoning: { maxDepth: 4 },
  response: { naturalness: 0.7, conciseness: 0.8 }
});
```

### 快速问答
```javascript
new AgentCore({
  memory: { windowSize: 5 },
  response: { naturalness: 0.6, conciseness: 0.9 }
});
```
