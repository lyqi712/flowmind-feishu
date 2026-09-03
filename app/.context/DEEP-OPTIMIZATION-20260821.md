# 深度优化（2026-08-21 20:00）

真实代码改动，不是文档空转。

## 1. 寒暄少扫库（`/api/agent/run`）

`agentRunNeedsKnowledgeScan()`：你好 / 确认 / 翻译一下 等快路径不再 `currentKnowledgeMaterials()`（最多 1000 篇 sqlite 正文）。有 documentIds、选区、附件时仍扫库。

`/api/chat/stream` 仍全量扫库，避免旧聊天检索回归。

## 2. 超长问题硬上限（F-04）

`AGENT_QUESTION_MAX_CHARS = 32KiB`

- runtime：超长抛 `AGENT_QUESTION_TOO_LONG` status 413，不检索不调模型
- `/api/agent/run`、`/api/chat/stream`：解析后立刻 413

T3.4：1MB 问句 **413 / ~36ms**（原先可跑 20+ 分钟）

## 3. research 空检索拒绝编造（F-03）

`emptyRetrievalDecision` 覆盖 answer **和** research。change（写笔记/草稿）不挡。

单测：空库 +「分析本周发布风险」`citationStatus=empty_retrieval`，模型调用 0 次。

## 测试

```
node --test tests/agent-runtime.test.mjs tests/retrieval-policy.test.mjs tests/agent-api.test.mjs
```

生产路径全绿。

`tests/adversarial-ai-robustness.test.mjs` 仍有 4 个旧失败（T2.1 FakeModel 计数、T3.1 注入噪音空检索、T5.2 无库追问、RED-TEAM 正则过严）。T3.4 已绿。未为假绿改阈值或 skip。
