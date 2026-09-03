# FlowMind MCP Server

标准 MCP stdio Server，暴露：

- `flowmind_status`
- `list_documents`
- `search_knowledge`
- `ask_knowledge`
- `run_skill`
- `feishu_discover`
- `feishu_sync`
- `flowmind://connect`
- `flowmind://status`
- `flowmind://documents`
- `flowmind://documents/{documentId}`

最快的接入方式：在 FlowMind 设置 → 模型与 Provider → **复制给其他 AI 的提示词**，把那段话发给 Claude / ChatGPT / Cursor。对方按提示词用 stdio 连上后即可检索本机知识库；`ask_knowledge` 没有 citations 时不得编造。

启动：

```powershell
npm.cmd run mcp:start
```

协议 smoke：

```powershell
npm.cmd run mcp:smoke
```

`FLOWMIND_STATE_FILE` 指向本地状态文件；`FLOWMIND_API_URL` 指向正在运行的 FlowMind HTTP API。MCP Server 不返回飞书或模型密钥。
