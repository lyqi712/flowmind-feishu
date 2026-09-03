# 子对话审查后补丁（2026-08-21 19:50）

审查来源：`E2E-VERIFICATION.md` + `ADVERSARIAL-REVIEW-20260821.md`

## 已修

### F-01 问这篇死路径（P1）

- `ContentReader.openAskComposer` 改为 `onAsk('', null)`，不再传假选区对象
- `handleReaderAsk` 用 `hasReaderSelection`：只有 quote/text/anchor 才算选区
- 无选区 → `createChatWorkspaceTab` + `scene.documentIds`

### F-02 选定范围泛问 empty_retrieval（P1）

- 范围内 bootstrap search 若没有 text-match，对已选文档（最多 3 篇）强制 `knowledge.read`
- 大范围（90 篇有 text-match）不额外全量 read，避免撑爆 ledger

## 测试

`node --test tests/agent-runtime.test.mjs tests/workspace-ai-fusion.test.mjs tests/content-reader.test.mjs tests/graph-suggestion-write.test.mjs`

**56 pass / 0 fail**

## 未修（审查遗留）

- F-03 research 空库仍可能进模型（P1，偏安全门禁扩展）
- F-04 超长问题未硬上限（可用性）
- 寒暄 HTTP 仍会 `currentKnowledgeMaterials()` + 会话 persist；runtime 已收成单次写盘
- AgentCore 仍不进入 `/api/agent/run`
