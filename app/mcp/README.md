# FlowMind MCP Server

标准 MCP stdio Server，暴露：

- `flowmind_status`
- `list_documents`
- `search_knowledge`
- `ask_knowledge`
- `run_skill`
- `feishu_discover`
- `feishu_sync`
- `flowmind://status`
- `flowmind://documents`
- `flowmind://documents/{documentId}`

启动：

```powershell
npm.cmd run mcp:start
```

协议 smoke：

```powershell
npm.cmd run mcp:smoke
```

`FLOWMIND_STATE_FILE` 指向本地状态文件；`FLOWMIND_API_URL` 指向正在运行的 FlowMind HTTP API。MCP Server 不返回飞书或模型密钥。
