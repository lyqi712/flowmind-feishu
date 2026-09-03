# FlowMind 扩展 AI 工具集

## 概述

扩展工具集为 FlowMind AI 提供了超越基础知识库问答的深度能力，支持：

- 🔍 **深度理解**：文档对比、时间线提取、矛盾检测
- ✍️ **写作辅助**：大纲生成、草稿撰写、结构化写作
- 📊 **数据分析**：关键词提取、情感分析、结构化提取
- 📋 **任务管理**：任务拆解、优先级排序、依赖识别
- 💡 **创意讨论**：头脑风暴、灵感扩展、多角度思考

## 工具列表

### 1. knowledge.compare - 文档对比

深度对比两个文档，识别异同点、共同主题和独特内容。

**使用场景**：
- 对比不同版本的文档
- 比较不同观点或方案
- 识别文档演进变化
- 分析相似主题的差异

**参数**：
```typescript
{
  documentId1: string;      // 第一个文档ID
  documentId2: string;      // 第二个文档ID
  focusAspect?: string;     // 关注点（可选）
}
```

**返回值**：
```typescript
{
  document1: { id, title, length };
  document2: { id, title, length };
  comparison: {
    similarity: number;           // 相似度 0-100
    commonThemes: string[];       // 共同主题
    uniqueToDoc1: string[];       // 文档1独有内容
    uniqueToDoc2: string[];       // 文档2独有内容
    structuralDifferences: {...}  // 结构差异
  };
  sourceRefs: [...];
}
```

**示例**：
```javascript
// 对比两个产品方案
await toolRegistry.execute('knowledge.compare', {
  documentId1: 'doc-123',
  documentId2: 'doc-456',
  focusAspect: '技术架构'
}, context);
```

---

### 2. knowledge.timeline - 时间线提取

从文档中自动提取时间信息和相关事件。

**使用场景**：
- 项目历史梳理
- 事件时间轴构建
- 进度追踪分析
- 会议纪要整理

**参数**：
```typescript
{
  documentId: string;     // 文档ID
  startDate?: string;     // 起始日期过滤（可选）
  endDate?: string;       // 结束日期过滤（可选）
}
```

**返回值**：
```typescript
{
  documentId: string;
  title: string;
  totalEvents: number;
  timeline: Array<{
    date: string;         // 提取的日期
    context: string;      // 上下文片段
    lineNumber: number;   // 行号
    fullText: string;     // 完整行文本
  }>;
  dateRange: { start, end };
  sourceRefs: [...];
}
```

**示例**：
```javascript
// 提取项目时间线
await toolRegistry.execute('knowledge.timeline', {
  documentId: 'project-notes-789',
  startDate: '2024-01-01',
  endDate: '2024-12-31'
}, context);
```

---

### 3. writing.draft - 写作草稿生成

根据主题生成结构化的写作大纲。

**使用场景**：
- 文章写作起步
- 报告框架搭建
- 提案结构规划
- 演讲稿大纲

**参数**：
```typescript
{
  topic: string;                    // 写作主题
  type?: 'article' | 'report' | 'proposal';  // 文档类型
  referenceDocumentIds?: string[];  // 参考文档
}
```

**支持的文档类型**：
- `article`：文章（引言、核心观点、论据、结论）
- `report`：报告（概述、背景、分析、建议、总结）
- `proposal`：提案（问题陈述、解决方案、实施计划、预期成果）

**返回值**：
```typescript
{
  topic: string;
  type: string;
  structure: {
    outline: Array<{
      order: number;
      title: string;
      content: string;      // 章节说明
      wordCount: string;    // 建议字数
      status: 'pending';
    }>;
    totalEstimatedWords: number;
  };
  references: {...};
  writingTips: string[];
  sourceRefs: [...];
}
```

**示例**：
```javascript
// 生成技术报告大纲
await toolRegistry.execute('writing.draft', {
  topic: 'AI在知识管理中的应用',
  type: 'report',
  referenceDocumentIds: ['ref-001', 'ref-002']
}, context);
```

---

### 4. analyze.keywords - 关键词分析

提取文档关键词，进行词频分析和情感分析。

**使用场景**：
- 内容主题识别
- 情感倾向监测
- 关键信息提取
- 文档摘要生成

**参数**：
```typescript
{
  documentId: string;           // 文档ID
  limit?: number;               // 关键词数量 5-50，默认20
  includeSentiment?: boolean;   // 是否包含情感分析，默认true
}
```

**返回值**：
```typescript
{
  documentId: string;
  title: string;
  keywords: Array<{
    word: string;
    count: number;
  }>;
  topThemes: string[];          // Top 5 主题
  sentiment: {
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number;              // -1 到 1
    confidence: number;         // 0-100
    positiveCount: number;
    negativeCount: number;
  };
  statistics: {
    totalWords: number;
    uniqueWords: number;
    avgWordLength: number;
  };
  sourceRefs: [...];
}
```

**示例**：
```javascript
// 分析用户反馈
await toolRegistry.execute('analyze.keywords', {
  documentId: 'feedback-123',
  limit: 30,
  includeSentiment: true
}, context);
```

---

### 5. task.breakdown - 任务拆解

将复杂任务拆解为可执行的子任务。

**使用场景**：
- 项目规划
- 工作分解
- 里程碑设定
- 资源估算

**参数**：
```typescript
{
  description: string;          // 任务描述（至少10字符）
  referenceDocumentId?: string; // 参考文档ID
}
```

**返回值**：
```typescript
{
  taskDescription: string;
  breakdown: {
    mainGoal: string;           // 主要目标
    subtasks: Array<{
      id: string;
      order: number;
      title: string;
      estimated: string;        // 预估时间
      priority: 'high' | 'medium' | 'low';
      dependencies: string[];   // 依赖任务
    }>;
    totalEstimated: string;     // 总预估时间
    complexity: 'high' | 'medium' | 'low';
  };
  suggestions: string[];        // 执行建议
  sourceRefs: [...];
}
```

**示例**：
```javascript
// 拆解开发任务
await toolRegistry.execute('task.breakdown', {
  description: `
    开发用户管理系统：
    1. 设计数据库表结构
    2. 实现用户注册和登录
    3. 添加权限控制
    4. 编写单元测试
    5. 部署到测试环境
  `,
  referenceDocumentId: 'tech-spec-456'
}, context);
```

---

### 6. knowledge.extract - 结构化提取

从文档中提取结构化信息：列表、数据、关键点。

**使用场景**：
- 信息快速整理
- 数据点提取
- 列表汇总
- 关键指标识别

**参数**：
```typescript
{
  documentId: string;     // 文档ID
  extractType?: string;   // 提取类型，默认'all'
}
```

**返回值**：
```typescript
{
  documentId: string;
  title: string;
  extracted: {
    bulletPoints: string[];       // 无序列表项
    numberedPoints: string[];     // 有序列表项
    keyNumbers: Array<{
      value: string;              // 数值
      unit: string;               // 单位
      context: string;            // 上下文
    }>;
    totalBullets: number;
    totalNumbered: number;
    totalNumbers: number;
  };
  extractType: string;
  sourceRefs: [...];
}
```

**示例**：
```javascript
// 提取会议要点
await toolRegistry.execute('knowledge.extract', {
  documentId: 'meeting-notes-789',
  extractType: 'all'
}, context);
```

---

## 集成方式

### 在现有项目中启用

在 `app/server/agent/tool-registry.mjs` 中：

```javascript
import { registerExtendedTools } from './extended-tools.mjs';

// 创建 ToolRegistry 实例后
const registry = new ToolRegistry(options);

// 注册扩展工具
registerExtendedTools(registry);

// 现在可以使用扩展工具
const tools = registry.list({ includeWrite: false });
console.log('可用工具:', tools.map(t => t.name));
```

### 在 Agent Runtime 中使用

```javascript
// 工具已自动在 registry 中注册
// Agent 可以像使用内置工具一样调用

const result = await runtime.executeTool('knowledge.compare', {
  documentId1: 'doc-A',
  documentId2: 'doc-B'
}, context);
```

---

## 最佳实践

### 1. 组合使用工具

```javascript
// 场景：深度分析一个文档
// 1. 提取关键词了解主题
const keywords = await execute('analyze.keywords', { documentId });

// 2. 提取时间线了解发展
const timeline = await execute('knowledge.timeline', { documentId });

// 3. 提取结构化信息
const extracted = await execute('knowledge.extract', { documentId });
```

### 2. 利用参考文档

```javascript
// 写作时引用知识库内容
const draft = await execute('writing.draft', {
  topic: '新产品分析',
  type: 'report',
  referenceDocumentIds: ['market-research', 'competitor-analysis']
});
```

### 3. 任务规划链路

```javascript
// 1. 拆解任务
const breakdown = await execute('task.breakdown', {
  description: projectDescription,
  referenceDocumentId: requirementsDocId
});

// 2. 为每个子任务创建草稿
for (const subtask of breakdown.breakdown.subtasks) {
  await execute('writing.draft', {
    topic: subtask.title,
    type: 'proposal'
  });
}
```

---

## 错误处理

所有工具使用统一的错误格式：

```typescript
{
  code: string;      // 错误代码
  message: string;   // 错误消息
  status: number;    // HTTP 状态码
}
```

常见错误码：

- `KNOWLEDGE_DOCUMENT_NOT_FOUND` (404)：文档不存在
- `TOOL_ARGUMENT_INVALID` (400)：参数无效
- `KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE` (403)：文档超出范围

---

## 性能考虑

1. **文档大小限制**：
   - 关键词分析：推荐 < 100KB
   - 时间线提取：推荐 < 500KB
   - 文档对比：每个文档 < 200KB

2. **缓存策略**：
   - 关键词和情感分析结果可以缓存
   - 时间线提取结果在文档未变化时可复用

3. **批量处理**：
   - 避免在循环中频繁调用工具
   - 考虑使用批处理或并发执行

---

## 扩展开发指南

### 添加新工具

```javascript
registry.register({
  name: 'your.tool',
  effect: 'read',  // 或 'write', 'external'
  description: '工具描述',
  schema: {
    type: 'object',
    required: ['param1'],
    properties: {
      param1: { type: 'string', minLength: 1 }
    }
  },
  execute: async (args, context) => {
    // 工具实现
    return { result: 'success' };
  }
});
```

### 访问知识库

```javascript
execute: ({ documentId }, context) => {
  const getDocument = registry.getDocument.bind(registry);
  const document = getDocument(documentId);
  
  if (!document) {
    throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', 
      `Document not found: ${documentId}`, 404);
  }
  
  // 处理文档
}
```

---

## 测试覆盖

参见 `extended-tools.test.mjs` 获取完整测试套件。

关键测试场景：
- ✅ 基础功能测试
- ✅ 参数验证
- ✅ 错误处理
- ✅ 边界情况
- ✅ 性能基准

---

## 更新日志

### v1.0.0 (2026-08-21)
- 初始版本
- 6个核心工具：compare, timeline, draft, keywords, breakdown, extract
- 完整测试覆盖
- 文档和示例

---

## 支持

如有问题或建议，请提交 Issue 或联系开发团队。
