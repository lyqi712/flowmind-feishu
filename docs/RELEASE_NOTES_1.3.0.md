# FlowMind 1.3.0

Windows 安装包。源码在仓库里，完整安装器只放这一页。

## 安装

下载 `FlowMind 飞书 AI 工作台-1.3.0-x64.exe`，按向导安装。不会清空你已有的本地知识库。

- SHA256: `43C41CB81440944F4DA8662F829766C70A0915B46446216DFB104BC7924F0CA0`
- 约 176 MB

带本次引导、MCP `--mcp` 和斜杠收口的安装包，需要在本机重新执行 `cd app; npm run desktop:pack` 后再核对新 SHA。上面的哈希对应此前已发布的安装器。

## 这一版

- 没有证据的问题会拒答，不编造库里的事实
- 问答流式更顺，上翻时不抢滚动
- MCP：Claude / Codex 可检索本机知识库；设置里可接入其他 MCP（只读）
- 飞书密钥和模型 Key 仍只在本机加密保存

## 发布前实测（2026-09-03）

本机跑过，不是口号：

- HTTP 真服务：健康检查、空库拒答、mock 同步 5 篇、搜索命中、圈定文档后问答、新建问题记录、内网剪藏 400、MCP 提示词、两组并行问答
- MCP stdio smoke：检索、SQLite 独有文档、问答、Skill、资源读取，路径不外泄
- 桌面 host 冒烟：`/desktop-healthz`、`/api/state`、生产 `index.html`、未知 API 404