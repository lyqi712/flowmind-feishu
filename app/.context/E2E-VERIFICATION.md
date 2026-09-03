# E2E 验证（2026-08-21 18:43 GMT+8）

验证者：Proma 协作子 Agent（implement / 只验证，未改生产代码）。  
项目：`D:\luxiaofei\ima-feishu`。生产对话路径仍是 `server/agent/runtime.mjs`，未替换为 AgentCore。  
未重打安装包，未点飞书确认，未改 `graph-suggestion-write` 意图。

活服务：API `127.0.0.1:8789`（`/api/health` 200，`deepseek-chat` 已配置），Vite `127.0.0.1:5179`。  
原始 API 记录：`D:\luxiaofei\ima-feishu\.tmp\e2e-agent-run-verify.json`。

## 结论

| 项 | 结果 |
|---|---|
| 指定组测试 | **PASS** 44 / 0 fail |
| 附加契约测试 | **PASS** content-reader 25/25；`extended-tools.test.mjs` exit 0 |
| `你好` 快答 | **PASS** `conversation_only` + `fastReply` |
| 对比 Hermes / Agent Loop | **PASS** 两边原文，`sourceCount=4` |
| 无 pending「确认」不写入 | **PASS** `confirmation_idle`，笔记 10→10 |
| 浏览器点「问这篇」 | **FAIL**（环境 + 调用链）见 §4 |

整体：后端集成可用。阅读器「问这篇」活路径未建 chat tab。

---

## 1. 指定组测试

cwd 必须是 `D:\luxiaofei\ima-feishu\app`。

```text
cd D:\luxiaofei\ima-feishu\app
node --test tests/extended-tools-production-registry.test.mjs tests/workspace-ai-fusion.test.mjs tests/agent-runtime.test.mjs tests/agent-api.test.mjs tests/graph-suggestion-write.test.mjs tests/retrieval-policy.test.mjs
```

| | |
|---|---|
| 结果 | **44 pass / 0 fail / 0 skip** |
| 耗时 | 1797 ms |
| 含「问这篇」契约 | `无选区问这篇会开新对话 tab 并把当前文档锁进范围` **绿**（源码片段测试） |
| 含越权 | 生产 registry 越权 `KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE` **绿** |
| graph-suggestion-write | 确认写边 / 忽略不写 / rebuild 后边在，意图未改 |

附加：

```text
node --test tests/content-reader.test.mjs
→ 25 pass / 0 fail / 0 skip（1047 ms）

node server/agent/extended-tools.test.mjs
→ EXIT 0
```

---

## 2. 活库 `POST /api/agent/run`

健康检查：`GET http://127.0.0.1:8789/api/health` → 200。  
`storage=json`，`model.provider=openai-chat`，`model.id=deepseek-chat`，`configured=true`。文档 32 篇。

三次请求均为 `mode:"auto"`，未带 `documentIds`（全库范围）。未点任何确认按钮。

### 2.1 你好 → conversation_only / 快答 — PASS

```text
POST /api/agent/run
{"question":"你好","mode":"auto"}
```

| 字段 | 值 |
|---|---|
| HTTP | 200 |
| 耗时 | **6430 ms** |
| conversationId | `conversation_1787308899222_ryu4o79` |
| runId | `agent_c4da2fda-cb08-4040-a5ea-2a62d99bb351` |
| executionMode | `answer` |
| retrievalPolicy.reason | `conversation_only` |
| fastReply | `true` |
| citationStatus | `no-observation` |
| 引用 | 无 |
| 事件 | `start` → `done`（未调模型检索） |
| 答案 | 「你好。我是 FlowMind，可以帮你查知识库、读文档、写笔记或草稿、创建飞书文档、查图谱。直接说要做什么就行。」 |

### 2.2 对比 Hermes 和 Agent Loop — PASS

```text
POST /api/agent/run
{"question":"对比 Hermes 和 Agent Loop","mode":"auto"}
```

| 字段 | 值 |
|---|---|
| HTTP | 200 |
| 耗时 | **22978 ms** |
| conversationId | `conversation_1787308905443_6z6jspw` |
| runId | `agent_4d813c0d-ac6b-431b-941f-017c7a38292c` |
| executionMode | `research` |
| citationStatus | `grounded-observation` |
| relations | true，relatedDocuments **4** |
| confirmation | 无 |
| autoRead | 3 次 `knowledge.read` |

引用标题（去重 `sourceCount=4`，citations 条数 5）：

| 标题 | 角色 | id |
|---|---|---|
| Agent Loop：从长时运行幻觉到可验证的责任闭环 | Agent Loop 原文 | `item_91c227fdb7054d469b899a88` |
| 阅读 · Agent Loop | Agent Loop 笔记 | `note_1786031913652_83qzrz2` |
| B站学习笔记｜一口气学会 Hermes AI 智能体 Harness Loop 记忆系统实测 | Hermes 原文 | `item_5069072410c76c4ad2ed5d09` |
| 双社群共享总知识库 | 导航页 | `item_e893e8546e085d60be538396` |

判定：Hermes 原文 ≥1 且 Agent Loop 原文 ≥1 且 `sourceCount>=2` → **PASS**。

autoRead 窗口标题：Agent Loop 原文、Hermes B 站笔记、双社群总库。答案同时写了 Hermes 的 gateway / working memory / skill 记忆分层，以及 Agent Loop 的责任闭环 / 可靠性工程。

活 `start.capabilities` 已暴露只读扩展工具：`knowledge.compare`、`knowledge.timeline`、`knowledge.extract`、`writing.draft`、`analyze.keywords`、`task.breakdown`（均为 `effect:read`）。本轮对比题实际走的是 `knowledge.search` + 3× `knowledge.read`，模型未调用 compare。

观察（不挡过线）：其中 1 条 Agent Loop 引用 `evidenceStatus=unverified` / `source_excerpt_not_observed`。

### 2.3 无 pending「确认」不写入 — PASS

接 2.1 同一会话：

```text
POST /api/agent/run
{"question":"确认","mode":"auto","conversationId":"conversation_1787308899222_ryu4o79"}
```

| 字段 | 值 |
|---|---|
| HTTP | 200 |
| 耗时 | **1695 ms** |
| conversationId | `conversation_1787308899222_ryu4o79` |
| runId | `agent_700ba829-419b-488c-8361-2fb8c74837b0` |
| retrievalPolicy.reason | `confirmation_idle` |
| fastReply | `true` |
| confirmationId | 无 |
| 答案 | 「当前没有待确认的写入提案。直接说要写什么，我才会出确认面板。」 |
| 笔记 | 10 → 10，id 集合不变 |
| graph pending | 0 → 0 |

未点飞书确认，未出 `confirmation-required`，确认前零写入。

---

## 3. 浏览器「问这篇」— FAIL

目标：阅读器点「问这篇」→ `createChatWorkspaceTab` 且 `scene.documentIds` 锁当前文档。禁止点飞书确认。

### 3.1 环境

- 打开 `http://127.0.0.1:5179/`，标题 `FlowMind · 飞书 AI 工作台`，AX 可见知识库 / 文档 tab。
- 已打开文档 tab：`hermesAgent多智能体的几种用法`（`item_4ba4054a5c31ddc86cff3f6d`）。
- Proma 受管浏览器 `visible:false`，`innerWidth/innerHeight=0`，截图失败（「尚未完成可捕获布局」）。
- 「问这篇」在 AX 中可见（`r4-18`），但 `getBoundingClientRect()` 为 `{x:-111,y:14,w:36,h:32}`，`inViewport=false`。

因此：**视觉点击不可作为真机验收**。下面用 DOM `button.click()` 补验调用链。

### 3.2 活点击结果

| 动作 | 结果 |
|---|---|
| BrowserClick AX「问这篇」 | dispatched；未出现 `问《...》` tab |
| `document.querySelector` 找到按钮后 `.click()` | workspace session 仍 1 个 document tab |
| `localStorage flowmind.workspace.session` | `activeTabId=document-item_4ba4054a5c31ddc86cff3f6d`，`chatTabs=[]`，无 `documentIds` |
| 阅读器内部对话 | `conversationOpen=false` |
| 飞书 | 未点「在飞书中打开」，未点任何确认 |

### 3.3 调用链缺口（源码，已对活点击）

`ContentReader.openAskComposer`（无选区）调用：

```js
onAsk('', { documentId: item.id, title: item.title, source: item.source || item.sourceType || '知识库' });
```

`main.jsx handleReaderAsk` 判定：

```js
if (!text && !selection) {
  createChatWorkspaceTab({ scene: { documentIds: [documentId], agentMode: 'auto' } });
  return;
}
if (!text || !item?.id || readerChat.streaming) return;
```

第二参是真对象 → `selection` 为真 → 不建 tab；`text` 为空 → 随后直接 return。  
契约测试只断言两边源码片段各自存在，**没有串起来跑**，所以指定组绿、活路径空。

建议（本轮未改）：`openAskComposer` 无选区时 `onAsk('', null)`，或 `handleReaderAsk` 只把带 `quote`/`anchor` 的对象当选区。

---

## 4. 未做 / 边界

- 未重打安装包。
- 未真点飞书确认，未改 graph-suggestion-write。
- 未用 AgentCore 替换 runtime。活 `start` 来自 `runtime.mjs`（DeepSeek + NDJSON + autoRead + confirmation_idle）。
- 受管浏览器 viewport=0，不能当作桌面 Electron 真机。
- 对比题未强制模型调用 `knowledge.compare`；只证明工具已注册且检索/引用路径可用。
