# 🚀 Agent 内核快速参考

## 一分钟上手

```javascript
import { AgentCore } from './server/agent/core.mjs';

// 创建 + 配置 + 使用
const agent = new AgentCore();
agent.setDocuments([{ id: '1', title: 'AI', content: 'AI是...' }]);
const response = await agent.processMessage('什么是AI？');
console.log(response.content);
```

## 核心能力速查

| 能力 | 方法 | 用途 |
|------|------|------|
| 💬 对话 | `processMessage(msg)` | 处理用户消息 |
| 🌊 流式 | `streamMessage(msg)` | 实时响应 |
| 📚 设置文档 | `setDocuments(docs)` | 加载知识库 |
| 🔍 搜索历史 | `searchHistory(query)` | 查找对话 |
| 📊 统计 | `getStats()` | 获取数据 |
| 💾 持久化 | `export() / import()` | 保存/恢复 |

## 意图类型

```javascript
import { INTENT_TYPES } from './server/agent/intent-classifier.mjs';

INTENT_TYPES.KNOWLEDGE_QUERY    // 查询知识
INTENT_TYPES.ANALYSIS            // 分析对比
INTENT_TYPES.WRITING             // 写作创作
INTENT_TYPES.CHAT                // 闲聊
```

## 配置模板

### 对话型
```javascript
new AgentCore({
  memory: { windowSize: 10 },
  response: { naturalness: 0.9, conciseness: 0.6 }
});
```

### 分析型
```javascript
new AgentCore({
  reasoning: { maxDepth: 4 },
  response: { naturalness: 0.7, conciseness: 0.8 }
});
```

## 典型场景

### 1. 知识问答
```javascript
const r = await agent.processMessage('什么是机器学习？');
console.log(r.content);      // 答案
console.log(r.sources);      // 来源
```

### 2. 对比分析
```javascript
const r = await agent.processMessage('对比A和B');
console.log(r.analysisData.similarities);  // 相似点
console.log(r.analysisData.differences);   // 差异点
```

### 3. 连续对话
```javascript
await agent.processMessage('什么是AI？');
const r = await agent.processMessage('它的应用？'); // 自动理解上下文
console.log(r.intent.isFollowUp);  // true
```

### 4. 会话管理
```javascript
// 导出
const data = agent.export();
await saveToDatabase(sessionId, data);

// 恢复
const data = await loadFromDatabase(sessionId);
agent.import(data);
```

## 性能指标

| 操作 | 耗时 | 评级 |
|------|------|------|
| 意图识别 | <5ms | ⭐⭐⭐⭐⭐ |
| 简单查询 | 30-50ms | ⭐⭐⭐⭐⭐ |
| 复杂推理 | 100-200ms | ⭐⭐⭐⭐ |

## 关键模块

```
core.mjs                 → 主入口（整合所有模块）
intent-classifier.mjs    → 意图识别（7种类型）
reasoning-engine.mjs     → 推理引擎（深度理解）
tool-orchestrator.mjs    → 工具编排（CoT推理）
conversation-memory.mjs  → 对话记忆（滑动窗口）
response-generator.mjs   → 响应生成（自然语言）
```

## 调试技巧

```javascript
// 1. 查看推理过程
const r = await agent.processMessage('分析一下');
console.log(r.reasoning);

// 2. 查看意图识别
console.log(r.intent.type);
console.log(r.intent.confidence);

// 3. 查看处理时间
console.log(r.processingTime);

// 4. 查看统计
const stats = agent.getStats();
console.log(stats);
```

## 错误处理

```javascript
try {
  const r = await agent.processMessage(msg);
  if (r.type === 'error') {
    console.error('业务错误:', r.error);
  }
} catch (err) {
  console.error('系统错误:', err);
}
```

## 集成示例

### Express
```javascript
app.post('/chat', async (req, res) => {
  const agent = getAgent(req.body.sessionId);
  const response = await agent.processMessage(req.body.message);
  res.json(response);
});
```

### WebSocket
```javascript
ws.on('message', async (msg) => {
  for await (const chunk of agent.streamMessage(msg)) {
    ws.send(JSON.stringify(chunk));
  }
});
```

## 测试

```bash
# 运行测试
node server/agent/test-agent.mjs

# 测试覆盖
✅ 意图识别
✅ 推理引擎
✅ 对话流程
✅ 错误处理
✅ 性能基准
```

## 文档索引

- 📖 **README.md** - 快速开始
- 🏗️ **ARCHITECTURE.md** - 架构设计
- 📚 **API.md** - 完整API
- 💡 **EXAMPLES.md** - 20+示例
- ✅ **DELIVERY.md** - 交付总结

## 常见问题

**Q: 如何提升响应速度？**
A: 减少文档数量、降低推理深度、使用缓存

**Q: 如何添加自定义工具？**
A: 参考 `EXAMPLES.md` 第15节

**Q: 如何持久化会话？**
A: 使用 `export()` 和 `import()`，参考 `EXAMPLES.md` 第11-12节

**Q: 支持多语言吗？**
A: 目前针对中文优化，可扩展其他语言

## 快速诊断

| 问题 | 检查项 | 解决方案 |
|------|--------|---------|
| 响应慢 | 文档数量 | 减少或分批加载 |
| 意图错误 | 置信度 | 调整阈值或增加规则 |
| 记忆溢出 | windowSize | 调小窗口或增加摘要阈值 |
| 推理不准 | maxDepth | 增加深度或优化图谱 |

## 最佳实践

1. ✅ 为每个用户维护独立 Agent 实例
2. ✅ 定期持久化会话（每5-10轮）
3. ✅ 清理长时间不活动的会话
4. ✅ 捕获错误并提供降级体验
5. ✅ 监控处理时间和内存

## 开发建议

```javascript
// 开发模式：详细日志
const agent = new AgentCore({ debug: true });

// 生产模式：性能优先
const agent = new AgentCore({
  memory: { windowSize: 5 },
  response: { conciseness: 0.9 }
});
```

---

**💡 提示**: 这是一个快速参考，详细内容请查看完整文档。

**📞 支持**: 查看 `ARCHITECTURE.md` 了解设计细节，`API.md` 查询具体方法。
