# P0 / Agent 集成核验（2026-08-21 18:40）

父 Agent 接手。原因：续跑子对话时渠道返回 403「API Key 所属分组未到开启时间」。

## 质量判定（先于改代码）

| 项 | 判定 |
|---|---|
| 「问这篇」 | 上一轮已有真代码。缺口：新 chat tab 没把当前文档写进 `scene.documentIds`。 |
| 知识库按钮 / 标签切换 | 源码路径通：`selectNavigation` → `openWorkspaceModule` → `setActive`。早期无响应更像测到错误端口。`console.log` 不算修复，已删除。 |
| AgentCore 替换 runtime | **禁止**。runtime 是 DeepSeek + 证据 + 确认写入。本地 Jaccard 内核不能接管 `/api/agent/run`。 |
| extended-tools | 有实现、有单测，但未进生产 `ToolRegistry`。 |

## 本轮落地

1. `src/main.jsx`
   - 删除 `openWorkspaceModule` 调试日志
   - 「问这篇」创建 tab 时带 `scene.documentIds`，hydrate 后问答范围锁当前文档
2. `server/agent/tool-registry.mjs`
   - 构造后 `registerExtendedTools(this)`
   - `TOOL_SCHEMAS` 合并 `EXTENDED_TOOL_SCHEMAS`
   - 6 个工具全部 `effect:'read'`，确认前零写入
3. 测试
   - `tests/workspace-ai-fusion.test.mjs` 新增契约
   - `tests/content-reader.test.mjs` 新增 onAsk 路径
   - `tests/extended-tools-production-registry.test.mjs` 验证生产注册表

## 测试（cwd=`D:\luxiaofei\ima-feishu\app`）

```
node --test tests/extended-tools-production-registry.test.mjs tests/workspace-ai-fusion.test.mjs tests/agent-runtime.test.mjs tests/agent-api.test.mjs tests/graph-suggestion-write.test.mjs tests/retrieval-policy.test.mjs
→ 44 pass / 0 fail

node --test tests/content-reader.test.mjs tests/retrieval-performance.test.mjs
→ 35 pass / 0 fail

node server/agent/extended-tools.test.mjs
→ exit 0
```

`graph-suggestion-write` 意图未改：确认写边、忽略不写、rebuild 后边在。未 skip pdfjs/DOMMatrix。未真点飞书确认。未用 AgentCore 替换 runtime。

## 未做

- 浏览器真机点知识库/标签（子对话渠道不可用；源码与契约测试已绿）
- 活库对比题 API（依赖 8789 + DeepSeek，本轮未强制）
- AgentCore 仍是可选模块，不进入主对话路径
