# 扩展工具集成指南

## 快速集成

### 1. 在 tool-registry.mjs 中集成

修改 `app/server/agent/tool-registry.mjs`，在文件末尾添加：

```javascript
import { registerExtendedTools } from './extended-tools.mjs';

// 在 createToolRegistry 函数中
export function createToolRegistry(options) {
  const registry = new ToolRegistry(options);
  
  // 注册扩展工具
  registerExtendedTools(registry);
  
  return registry;
}
```

### 2. 验证集成

运行测试套件：

```bash
cd D:\luxiaofei\ima-feishu\app
node server/agent/extended-tools.test.mjs
```

### 3. 查看示例

```bash
node server/agent/extended-tools-examples.mjs
```

## 集成步骤详解

### 步骤 1: 导入模块

在需要使用扩展工具的地方导入：

```javascript
import { registerExtendedTools, EXTENDED_TOOL_SCHEMAS } from './extended-tools.mjs';
```

### 步骤 2: 注册到现有 Registry

```javascript
// 在创建 ToolRegistry 后立即注册
const registry = new ToolRegistry({
  getDocuments,
  contentRepository,
  graphIndex,
  writers,
  mcpGateway,
  fileGateway,
  feishuGateway
});

// 注册扩展工具
registerExtendedTools(registry);
```

### 步骤 3: 在 AI 对话中使用

扩展工具会自动出现在 AI 可用工具列表中，AI 可以根据对话内容自动选择合适的工具。

```javascript
// Agent Runtime 会自动发现这些工具
const tools = registry.list({ includeWrite: false });
// 返回包含: knowledge.compare, knowledge.timeline, writing.draft 等

// AI 自动调用示例
"用户: 帮我对比一下这两个文档的区别"
AI 会自动调用 knowledge.compare 工具
```

## 工具能力矩阵

| 工具名称 | 效果 | 主要用途 | 输入 | 输出 |
|---------|------|----------|------|------|
| knowledge.compare | read | 文档对比 | 2个文档ID | 相似度、异同点 |
| knowledge.timeline | read | 时间线提取 | 文档ID、日期范围 | 事件列表 |
| writing.draft | read | 生成大纲 | 主题、类型 | 结构化大纲 |
| analyze.keywords | read | 关键词分析 | 文档ID、数量 | 关键词、情感 |
| task.breakdown | read | 任务拆解 | 任务描述 | 子任务列表 |
| knowledge.extract | read | 信息提取 | 文档ID | 列表、数据点 |

## AI 提示词增强

为了让 AI 更好地使用这些工具，可以在系统提示词中添加：

```
你现在可以使用以下扩展能力：

深度理解：
- 对比分析两个文档的异同 (knowledge.compare)
- 从文档中提取时间线 (knowledge.timeline)
- 提取结构化信息 (knowledge.extract)

写作辅助：
- 生成文章、报告、提案大纲 (writing.draft)

数据分析：
- 提取关键词和主题 (analyze.keywords)
- 进行情感分析

任务管理：
- 将复杂任务拆解为子任务 (task.breakdown)

使用这些工具时要：
1. 先确认用户需求
2. 选择最合适的工具
3. 解释工具的输出结果
4. 提供可操作的建议
```

## 场景触发示例

### 场景 1: 版本对比
```
用户: "帮我看看需求文档 v1 和 v2 有什么区别"

AI 思考:
- 用户要对比两个文档
- 应该使用 knowledge.compare 工具

AI 调用:
{
  "tool": "knowledge.compare",
  "arguments": {
    "documentId1": "requirements-v1",
    "documentId2": "requirements-v2"
  }
}

AI 回复:
"我对比了两个版本的需求文档：

相似度: 75%

主要变化：
1. v2 新增了 AI 智能搜索功能
2. 用户目标从 10,000 提升到 50,000
3. 响应时间要求从 200ms 降低到 150ms
..."
```

### 场景 2: 项目时间线
```
用户: "项目会议记录里都有哪些关键时间点？"

AI 调用: knowledge.timeline

AI 回复:
"从会议记录中提取到 12 个关键时间节点：

2024-01-15: 项目启动会议
2024-02-01: 原型设计评审
2024-03-10: Alpha 版本发布
..."
```

### 场景 3: 内容创作
```
用户: "帮我写一篇关于 AI 知识管理的文章大纲"

AI 调用: writing.draft

AI 回复:
"为您生成了文章大纲：

标题: AI 在知识管理中的应用

结构:
1. 引言 (200-300字)
   - 介绍知识管理的挑战
   
2. 核心观点 (400-600字)
   - AI 如何改变知识管理
..."
```

### 场景 4: 用户反馈分析
```
用户: "分析一下这个月的用户反馈"

AI 调用: analyze.keywords

AI 回复:
"用户反馈分析结果：

整体情感: 正面 (得分 0.65)

高频关键词:
1. 搜索 (45次)
2. 界面 (32次)
3. 速度 (28次)
..."
```

### 场景 5: 任务规划
```
用户: "把这个开发需求拆解成具体任务"

AI 调用: task.breakdown

AI 回复:
"已为您拆解任务：

主要目标: 开发用户管理系统

子任务:
1. [task-1] 设计数据库表结构
   优先级: high
   预估: 2-4h
..."
```

## 测试清单

- [ ] 所有工具都已注册到 registry
- [ ] 工具在 registry.list() 中可见
- [ ] 每个工具的 schema 定义正确
- [ ] 参数验证正常工作
- [ ] 错误处理符合预期
- [ ] sourceRefs 正确生成
- [ ] 运行测试套件全部通过
- [ ] 性能测试通过
- [ ] AI 能够正确调用工具
- [ ] 工具输出格式符合预期

## 性能优化建议

1. **大文档处理**
   - 对超过 100KB 的文档，考虑分块处理
   - 关键词提取限制在前 50,000 字符

2. **缓存策略**
   - 关键词分析结果可缓存 1 小时
   - 时间线提取结果在文档未变化时复用

3. **并发控制**
   - 同时分析多个文档时使用 Promise.all
   - 但要注意内存占用

4. **渐进增强**
   - 先返回部分结果，再补充完整分析
   - 用户体验更好

## 故障排查

### 工具未出现在列表中
检查是否正确调用了 `registerExtendedTools(registry)`

### 参数验证失败
检查传入的参数是否符合 schema 定义

### 文档未找到
确认文档 ID 正确，且文档在 contentRepository 中

### 性能问题
- 检查文档大小
- 考虑使用更小的 limit 参数
- 查看是否有大量重复调用

## 下一步

1. **添加更多工具**
   - 矛盾检测
   - 因果分析
   - 概念图生成

2. **增强现有工具**
   - 更智能的关键词提取
   - 更准确的情感分析
   - 更复杂的任务依赖识别

3. **集成外部能力**
   - OCR 文字识别
   - 图表数据提取
   - 多语言支持

4. **提升 AI 理解**
   - 优化工具描述
   - 添加使用示例
   - 改进提示词工程
