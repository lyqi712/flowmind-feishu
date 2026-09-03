# Execution Contract — FlowMind 飞书 AI 工作台

## User-visible deliverable
一个可在 Windows 本地直接运行、适合日常知识工作的成熟 AI 工作台：无需手工查找 Space ID 即可连接飞书，统一同步知识库、Docx/Wiki/Sheet/Bitable/Folder 等内容，完成搜索、阅读、问答、引用、笔记、写作、分析、Copilot、Skill、历史与导出，并通过标准 MCP 接入 Claude、Codex 和其他 AI 客户端。

## Canonical workspace
- Path: `D:\luxiaofei\ima-feishu`
- Integration branch: `codex/ima-feishu-replica`

## Acceptance scenarios
1. 首次启动时只需填写一次飞书 App ID/Secret，并可直接粘贴飞书链接；应用自动发现可访问知识空间，无需手工复制 Space ID。
2. 用户可同步 Docx、Wiki、知识空间、关联文档、Sheet、Bitable 与 Drive Folder；同步结果包含进度、类型统计、跳过项、警告与可重试错误。
3. 用户可全局搜索、筛选和阅读文档，使用真实模型完成带可点击引用的问答，并管理会话历史。
4. 用户可创建/编辑/归档笔记，使用写作、文档分析、自定义 Copilot 与可配置 Skill 工作流，并查看运行过程、产物和历史。
5. 用户可通过标准 MCP stdio Server 从 Claude Desktop、Codex 或其他 MCP 客户端执行状态、飞书、检索、问答与 Skill 工具，并读取文档资源。
6. 模型层支持自定义 URL、API Key、模型名、鉴权 Header、请求/响应映射和主流兼容格式，凭据加密保存且不进入 state.json、日志、API 响应或提交。
7. Web 桌面视图、390×844 移动视图、Electron Host 与便携版均可启动并完成核心日常工作流。

## Required artifacts and evidence
- Runnable app: `D:\luxiaofei\ima-feishu\app`
- Portable package: `D:\luxiaofei\ima-feishu\app\desktop\out`
- Research: `D:\luxiaofei\ima-feishu\research`
- Automated/live evidence: `D:\luxiaofei\ima-feishu\evidence`
- MCP templates and smoke evidence: `D:\luxiaofei\ima-feishu\app\mcp`, `D:\luxiaofei\ima-feishu\evidence\mcp-*.json`

## Definition of done
- [x] Required P0 product code integrated into the canonical branch.
- [x] Working tree clean after final commit; intentional exclusions disclosed.
- [x] Unit/integration tests, production build and dependency audit pass.
- [x] Real Feishu discovery, recursive multi-document sync, search, model Q&A and all Skills pass.
- [x] MCP initialize/listTools/callTool/readResource smoke passes without credential leakage.
- [x] Product launched and desktop/mobile acceptance scenarios saved as evidence.
- [x] Electron host and rebuilt portable package smoke pass.
- [x] Secret scan and continuity checker pass.
- [x] PROJECT_STATE, HANDOFF, DECISIONS and README are current.

## Non-goals / honest degradation
- 不复制目标产品私有源代码、模型权重、账号数据或服务端秘密；按可观察行为独立实现。
- 飞书 Slides、Mindnote 或普通二进制 File 若开放 API 无正文读取能力，必须在 UI 和同步结果中明确标记为可发现但正文降级，不得静默伪造。
- 代码签名、自动更新和应用商店发布不是本次本地便携交付门禁。

## Completion language gate
在全部适用门禁有证据且代码已提交前，状态只能是 `IN PROGRESS`，不得声称完成、可直接交付或成熟可用。
