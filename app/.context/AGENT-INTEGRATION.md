# Agent 集成（2026-08-21）

## 为什么不替换 runtime

`server/agent/runtime.mjs` 是生产对话路径：DeepSeek、NDJSON、`knowledge.search`/`knowledge.read`、autoRead、口头确认、`lastWritten`/`lastAnswer`、证据 ID。`AgentCore` 是规则内核，替换会把回答打成模板/词重叠，属于质量回退。

## 实际接入

- `createToolRegistry()` / `new ToolRegistry()` 默认注册：
  - `knowledge.compare`
  - `knowledge.timeline`
  - `knowledge.extract`
  - `writing.draft`
  - `analyze.keywords`
  - `task.breakdown`
- 模型侧通过 `registry.list()` → `toolProtocol` 的 Available tools 自动看到这些只读工具。
- 写入工具仍走 confirmation，本轮未改。

## 验证

`tests/extended-tools-production-registry.test.mjs`：默认 registry 含 6 个只读工具；compare 成功；缺文档 `KNOWLEDGE_DOCUMENT_NOT_FOUND`。

agent-runtime 14 + agent-api 全绿。
