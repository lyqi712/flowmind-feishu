# FlowMind 飞书 AI 工作台

FlowMind 是一个本地优先的知识工作台：把飞书文档和本地文件导入 SQLite/FTS 内容层，再通过可回查引用的问答、文档阅读、笔记、写作、Agent、Skill、知识图谱和 MCP 接口完成工作。

这个仓库发布的是可复现的应用源码，不包含任何真实飞书知识库、运行数据库、API 密钥、浏览器用户数据或安装包。

## 能力概览

- 飞书 Docx、Wiki、Sheet、Bitable、Folder 和本地文件导入、去重、版本化
- Markdown、PDF、扫描 PDF、图片、DOCX、PPTX、XLSX、EPUB、XMind 等内容解析
- SQLite 内容仓库、FTS 检索、页码/区域/时间/文本 Anchor 和可点击引用
- 普通模型问答、跨文档比较、冲突分析和受控 Agent 工作流
- `@` 选择资料：服务端验证范围，回答展示实际索引规模和证据来源
- Markdown 笔记、双向链接、来源回跳、写作草稿和 Skill 产物
- 仅显示可归因显式关系的知识图谱，未解析链接和 AI 建议单独隔离
- OpenAI Chat、OpenAI Responses、Anthropic、Gemini、Ollama、Azure OpenAI 和自定义 HTTP Provider
- 标准 stdio MCP Server，提供文档列表、搜索、问答、Skill 和飞书同步工具
- Electron Windows 桌面壳，可选生成 NSIS/portable 包

## 环境要求

- Node.js 22 LTS 或更高版本
- Windows 10/11（完整 Electron 与 OCR 能力按 Windows 验证）
- 远程模型和飞书同步均为可选；使用本地检索模式不需要先配置云端凭据

## 快速启动

```powershell
git clone https://github.com/lyqi712/flowmind-feishu.git
cd flowmind-feishu\app
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

开发模式默认提供：

- Web UI：`http://127.0.0.1:5173/`
- API：`http://127.0.0.1:8789/`

端口被占用时，Vite 会自动选择下一个可用端口；API 端口可通过 `PORT` 调整。

## 配置

可以直接在应用的“设置 → 模型连接”和飞书连接向导中配置。也可以在 `.env.local` 中设置：

```dotenv
MODEL_PROVIDER=local
MODEL_BASE_URL=https://your-relay.example/v1
MODEL_API_KEY=
MODEL_DEFAULT=your-model-id
MODEL_TIMEOUT_MS=120000
MODEL_RETRIES=2
MODEL_RETRY_DELAY_MS=500
MODEL_FALLBACK_TO_LOCAL=true

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_SPACE_ID=
```

`.env.local` 只存在于本机，永远不要提交。应用会把运行状态、SQLite 内容库和加密密钥写到本地运行目录；这些数据不属于公开仓库。

## 常用命令

在 `app` 目录执行：

```powershell
# 运行完整测试和生产构建
npm.cmd run check

# 生产构建与启动
npm.cmd run build
npm.cmd start

# MCP Server 与 smoke 验证
npm.cmd run mcp:start
npm.cmd run mcp:smoke

# Electron 验证/打包（Windows）
npm.cmd run desktop:smoke
npm.cmd run desktop:pack
npm.cmd run desktop:portable
```

## MCP

MCP 入口是 `app/mcp/server.mjs`。默认使用 `${FLOWMIND_STATE_FILE}.content.sqlite`，也可以通过 `FLOWMIND_CONTENT_DATABASE` 指定 SQLite 文件。客户端配置示例放在 `app/mcp/`，请把路径改成自己的本地路径，不要把密钥写进配置文件。

## 项目结构

```text
app/server/content/       内容仓库、导入、版本和附件
app/server/retrieval.mjs  检索、证据片段和引用
app/server/agent/         Agent 运行时、工具和确认闸门
app/server/graph/         显式来源图谱索引
app/server/model/         Provider、超时和重试
app/src/                  React/Vite 工作台
app/mcp/                  stdio MCP Server 与 smoke
app/desktop/              Electron 主进程和打包配置
app/tests/                Node/API/UI 回归测试
scripts/desktop/          Electron 启动、打包和 smoke 脚本
```

## 安全与隐私

- 飞书 App Secret、模型 API Key 不应进入 Git；应用运行时会脱敏 API 响应并使用本地加密存储。
- Agent 的本地写入、文件/外部能力和其他副作用必须经过确认；资料中的指令按不可信内容处理。
- `runtime-data/`、`.env.local`、SQLite、OCR 数据、浏览器 profile、构建目录和 evidence 默认不应公开。
- 使用自己的飞书应用和知识空间；本仓库不提供任何第三方凭据或真实用户资料。

## 贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前至少运行：

```powershell
cd app
npm.cmd install
npm.cmd run check
```

新功能应同时补充服务端/API 测试；涉及用户界面时，还应验证桌面和 390px 窄屏布局。

## 安全问题

不要在公开 issue 中粘贴 API Key、App Secret、访问令牌、运行数据库或真实知识库内容。安全问题请使用 GitHub 私密安全报告，或直接联系仓库维护者。

## License

本项目采用 MIT License，详见 [LICENSE](LICENSE)。
