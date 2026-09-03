# 超级 AI 知识库：可学习项目调研

日期：2026-08-25  
范围：开源优先，闭源只学可观察 UX。不改业务代码。FlowMind 已有飞书同步、SQLite/FTS、多模型、sourceRefs、MCP、Electron；缺的是舒适度和结构，不是功能清单。

## 一句话结论

超级 AI 知识库该做成 **「当前工作面里问、读、记例外」**：问答式问题记录、有引用的 RAG、舒服的文档阅读编辑、内嵌网页剪藏、多模型/MCP 外接。不该做成又一个功能广场，也不该重建第二套索引或换掉 FlowMind 壳。

## P0 必学

### [happy-friday-lite](https://github.com/cheney-plus/happy-friday-lite)
- 学：问答式笔记呈现、设置分组、文档阅读密度、留白与字号节奏。
- 不要学：品牌、仓库结构、把主导航拆掉。
- 映射：已拍板保留 FlowMind 壳，只抄笔记/设置/阅读编辑的舒适度。

### [kotaemon](https://github.com/Cinnamon/kotaemon)
- 学：和文档对话时引用可见、命中片段与原文并排、失败时诚实降级。
- 不要学：再做一套聊天门户首页。
- 映射：强化现有 Composer 引用卡片和 Reader sidecar，不新建 RAG 产品。

### [RAGFlow](https://github.com/infiniflow/ragflow)
- 学：chunk 质量、引用接地、Agent 用检索当工具而不是把全文塞进 prompt。
- 不要学：企业工作流编排后台、重型 pipeline UI。
- 映射：接到现有 SQLite/FTS + Anchor 命中窗口，禁止平行向量库作为第二事实源。

### [AFFiNE](https://github.com/toeverything/AFFiNE)
- 学：文档画布的阅读宽度、块级编辑手感、属性轻量出现。
- 不要学：白板无限画布作为主 IA。
- 映射：ContentReader / 笔记编辑的行高、最大宽、工具收进 overflow。

### [SiYuan](https://github.com/siyuan-note/siyuan)
- 学：大纲+正文、反链、块引用，本地优先的文档手感。
- 不要学：再做一个完整块编辑器内核。
- 映射：笔记阅读模式与问题记录卡片；飞书文档仍以同步正文+选区回源为主。

## P1 该学

### [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) / [Open WebUI](https://github.com/open-webui/open-webui)
- 学：多模型切换、知识库作为对话范围、工作区隔离。
- 不要学：把 FlowMind 变成通用 ChatUI 皮肤。
- 映射：设置里的 Provider 分组已经存在，学它们的「当前对话范围一目了然」。

### [Continue](https://github.com/continuedev/continue) / [goose](https://github.com/block/goose)
- 学：Agent 对当前文件/选区操作、MCP 工具、写回而不复制。
- 不要学：IDE 专属交互或任意命令执行。
- 映射：笔记助手把结论写入「下次容易忘的点」；浏览器剪藏同理。

### [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot)（插件，学交互）
- 学：在笔记里问、把答案变成笔记块、引用库内文档。
- 不要学：插件生态本身。
- 映射：Notes 右侧助手 + 问题记录结构化字段。

### [SilverBullet](https://github.com/silverbulletmd/silverbullet)
- 学：本地优先、命令面板驱动、页面即对象。
- 不要学：把所有能力做成 Space Lua 脚本平台。
- 映射：Ctrl+K 增加「打开网页 / 新建问题记录」，不加新导航。

## P2 可参考（多为闭源，只学观感）

- Heptabase / Scrintal：空间化卡片，适合图谱，不适合当主编辑器。
- Capacities / Tana：对象型笔记，问题记录可借鉴「对象+属性」而不是长文。
- NotebookLM：来源列表始终在答案旁边；落地为 sourceRefs 可见，而不是 Google 生态。
- Cubox / 简悦：网页剪藏到卡片；落地为内嵌浏览 + 剪进问题记录。
- Reflect / Mem：日记式回顾，适合「下次容易忘的点」的复现提醒，不做社交时间线。

## 「问题记录」交互节奏

1. 列表分「全部 / 问题记录 / 笔记」，问题记录显示问题作标题、教训作摘要。
2. 编辑三块：问题、这次怎么解决的、下次容易忘的点。不要默认一篇教程。
3. 问答、网页剪藏、选区，都是往这三块里追加，并带 sourceRefs。
4. 阅读模式用问答卡片，而不是密密麻麻 Markdown。
5. Agent 默认写「下次容易忘的点」，整篇答案只作为本次解决过程。

## 「很舒服的排版」共性

- 字号 15–16px，正文行高 1.7–1.85，阅读列宽约 680–800px。
- 侧栏图标轨 + 内容纸面，设置按「外观 / 模型 / 知识库 / 隐私」分组。
- 工具收入 overflow，选区出现气泡，不常驻一排图标。
- 空状态说下一步（记下容易忘的点），不说功能清单。

## 「接入外部 AI」该抄的入口

- 已有：加密 Provider、MCP stdio。强化「当前模型 / 当前范围」可见，工具能写回问题记录。
- 学 Continue/goose 的工具边界：读当前笔记/文档/剪藏，写 artifact，不默认操作系统级任意执行。
- 不要再做第三个 Agent 运行时。

## 明确不建议做

- 发现广场、博客、AI 生图、PPT、独立任务看板。
- 第二套向量库当事实源、重置用户库、换品牌壳。
- 完整飞书云文档协同编辑器（开放 API 能力不足时诚实只读+选区笔记）。

## 给实现侧的下一刀（杠杆顺序）

1. 问题记录作为独立类型：结构化编辑 + 列表筛选 + 问答阅读。
2. 工作台内嵌网页，剪藏进问题记录（私网 URL 拒绝，iframe 被挡时用可读预览）。
3. 笔记内助手把结论写入「下次容易忘的点」，免粘贴。
