# Agent Runtime 优化（2026-08-21）

生产路径仍是 `server/agent/runtime.mjs`，未替换为 AgentCore。未重打安装包，未真点飞书确认，未改 `graph-suggestion-write` 意图。

## 改动清单

| 文件 | 行为 |
| --- | --- |
| `app/server/agent/runtime.mjs` | 本地快答（`conversation_only` / 口头确认 / 打开刚才那篇 / 无上一句改写）在 persist 前判定，一次 `completeLocalRun` 写完 run+result+audit。原先 `persistRun` + `patchRun` + `audit(patchRun)` 三次全量 `store.update`。 |
| `app/tests/agent-runtime.test.mjs` | 「你好」断言 `store.update` 恰好 1 次，且审计事件仍是 `answer-fast-conversation`。研究题第一轮 system prompt 必须含 `knowledge.compare` 等只读扩展工具。未锁死工具列表、未撤工具。 |
| `app/src/main.jsx` `handleReaderAsk` | 未改。有文本走阅读器内对话；无文本且无选区才 `createChatWorkspaceTab` 并带 `scene.documentIds`。 |
| `uniqueReadTargets` / autoRead | 未改。仍把 `isDerivedKnowledgeNote` 放到 fallback，源文档优先。 |

## 寒暄耗时结论

活库 `runtime-data/state.json` **28,577,272 bytes**（pretty JSON）。副本剖析（只读复制，未写回活库）：

- `conversations` 108 条 ≈ 10.9MB JSON
- `agent.runs` 182 条 ≈ 5.5MB JSON
- `documents` 1 条（正文在 sqlite，约 1.1GB）
- `JsonStateStore.update()`：clone 全量 state + `JSON.stringify(state, null, 2)` + 原子写盘，单次 **406–463ms**
- `store.get()` clone：**89ms**
- 起服加载该 state：**282ms**（热盘；冷盘/杀毒扫描会更高）

改前：`你好` → `conversation_only` 不调模型，但 runtime 仍写盘三次。对活库副本实测 **1294ms / 3 次 update**。

改后：同一副本 **390ms / 1 次 update**。三次写盘是可去掉的同步瓶颈，已修。

「活库曾 6s」不是模型。叠加路径是：

1. 起服读 28MB pretty JSON（+ sqlite）
2. `/api/agent/run` 先 `store.get()` + `currentKnowledgeMaterials()`（sqlite `listContentItems` 最多 1000 篇带正文）
3. runtime 三次全量 persist（本轮已收成一次）
4. `persistAgentConversation` 再一次全量 persist（仍在 `app.mjs`）

热路径下 1+3 已能到约 1.3s；冷盘 + sqlite 列目录 + 会话落盘可以把端到端顶到数秒。PROGRESS 里后来的 757ms 与「三次写盘热缓存」同量级，6s 更像冷启动/扫库叠加，不是寒暄逻辑本身。

## 测试结果

cwd：`D:\luxiaofei\ima-feishu\app`

```text
node --test tests/agent-runtime.test.mjs tests/agent-api.test.mjs tests/extended-tools-production-registry.test.mjs tests/workspace-ai-fusion.test.mjs tests/retrieval-policy.test.mjs tests/graph-suggestion-write.test.mjs
```

**44/44 pass，0 fail。** 含：

- `conversation_only` 单次 persist
- auto 对比题 autoRead 仍优先 `hermes` / `agent-loop`，验收笔记不得独占
- 研究题 Available tools 含 `knowledge.compare` / `timeline` / `extract` / `writing.draft` / `analyze.keywords` / `task.breakdown`
- 阅读器有文本不跳 tab；无文本无选区开 tab 并锁 `documentIds`
- `graph-suggestion-write` 未改意图，原测试仍绿

## uniqueReadTargets / autoRead

`uniqueReadTargets` 仍：

- 跳过非 `text-match`
- `isDerivedKnowledgeNote`（`source: local-note|note`、`type: note`、标题 `知识笔记：`）进 fallback
- 返回 `[...preferred, ...fallback].slice(0, limit)`

auto 无选中文档时，search 后对 top 3 调 `knowledge.read`，`autoRead: true`。有选中文档只 bootstrap `knowledge.search`，不走 autoRead（原行为，未扩）。

## Available tools

`ToolRegistry` 构造时 `registerExtendedTools`。research/change 走 `toolProtocol` → `Available tools: ${names}`。研究题 fixture 第一轮 system prompt 已断言含 compare 等。测试只做包含断言，没有锁死工具全集。

answer/quick 仍用无工具短 system prompt（直接作答），不经过 `toolProtocol`。

## handleReaderAsk

```js
if (!text && !selection) {
  createChatWorkspaceTab({ scene: { documentIds: documentId ? [documentId] : [], agentMode: 'auto' } });
  return;
}
void streamReaderAsk(text, item, readerAskSelection(item, selection));
```

有文本（含选区提问）留在阅读器；空 prompt 且无选区才开新对话 tab。`workspace-ai-fusion` 覆盖。

## 未修项

- **未把 agent runs 从 28MB `state.json` 拆出去。** 单次 pretty-print 仍约 400ms。
- **未改 `JSON.stringify(state, null, 2)`。** compact JSON 能缩小体积，属于 store 层，不是 runtime 合同。
- **`/api/agent/run` 仍无条件 `currentKnowledgeMaterials()`**（sqlite 列最多 1000 篇正文）和 **`persistAgentConversation` 再写一次 28MB**。寒暄 HTTP 端到端还会再付这两笔。要继续压到亚秒，应在 app 层对 `conversation_only` 跳过扫库，或把 conversation/agent 分文件。
- **`publicSettings()` → `store.get()` 仍 clone 全量 state。** 寒暄路径一次，约 89ms。
- 未接 MCP / fileGateway，未改写入确认，未重打安装包。
