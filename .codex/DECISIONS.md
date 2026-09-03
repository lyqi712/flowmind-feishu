# Durable Decisions — FlowMind 飞书 AI 工作台

## 2026-08-01 — 本地优先的统一内容底座
- Decision: 以 SQLite/FTS 作为文档、Chunk、附件、标注和检索的统一事实来源，旧 `state.json` 内容幂等迁移。
- Reason: Web、Electron、MCP、搜索和问答必须共享同一份可离线查询的数据。
- Consequence: 新内容能力优先扩展统一仓储和 Anchor，不建立平行数据孤岛。
- Revisit only if: 需要多用户远程协作或单机数据规模超出 SQLite 可维护范围。

## 2026-08-01 — 凭据只在服务端加密保存
- Decision: 飞书 Secret 和模型 API Key 使用 AES-256-GCM 持久化，前端/API 只返回是否已配置和脱敏状态。
- Reason: 自定义中转站和飞书连接需要长期可用，但密钥不得进入状态文件、日志、证据或提交。
- Consequence: 前端保存后立即清空密钥输入；导出、备份和诊断必须继续执行敏感字段清洗。
- Revisit only if: 引入操作系统凭据库并完成跨 portable 场景迁移。

## 2026-08-01 — Provider 采用兼容适配层
- Decision: 支持 OpenAI Chat/Responses、Anthropic、Gemini、Ollama、Azure OpenAI 和自定义 HTTP，并允许配置 Base URL、Path、Header、请求/响应映射、SSE/NDJSON/JSON。
- Reason: 用户需要连接官方服务和不同第三方中转站，而不是绑定单一 API 形态。
- Consequence: Provider 测试、模型发现、重试、超时和本地回退必须走统一适配接口。
- Revisit only if: 新协议无法通过现有映射表达。

## 2026-08-02 — 飞书链接优先和自动发现
- Decision: 用户可直接粘贴 Docx/Wiki/Sheet/Bitable/Folder 链接，应用自动解析 Token、发现知识空间并递归同步关联内容。
- Reason: 日常使用不应要求用户反复查找 Space ID、Cert 或内部 Token。
- Consequence: 新飞书入口必须复用链接解析、权限诊断、进度、跳过项和可重试错误模型。
- Revisit only if: 飞书开放平台改变资源标识或权限模型。

## 2026-08-02 — 所有引用使用稳定 Anchor
- Decision: 文本、PDF、OCR 和音频统一使用 chars/page/region/time Anchor；标注和工作产物保留来源引用。
- Reason: 搜索、回答、阅读器定位和后续工作必须指向同一证据位置。
- Consequence: 新解析器和新产物不得只保存显示文本，必须保存可恢复的 `sourceRefs`。
- Revisit only if: 引入需要额外坐标系的媒体类型。

## 2026-08-03 — OCR 与音频运行时可离线工作
- Decision: portable 包内置 Tesseract.js 与中英文训练数据；音频原件私有保存并使用标准时间戳分段，转写 Provider 可配置。
- Reason: 便携版首次启动不能依赖在线下载，媒体引用需要跨重启稳定。
- Consequence: OCR 失败按页隔离并明确警告；无转写 Provider 时保留可读状态和本地会议纪要流程。
- Revisit only if: 更换离线识别引擎能显著降低包体且保持准确率。

## 2026-08-04 — 命中证据窗口驱动知识关系分析
- Decision: 跨文档主题、实体、共识、冲突和时间线只分析检索命中的有界证据窗口，不扫描整篇超长正文。
- Reason: 真实中文文档可达数十万字符，完整句子切分和无界 n-gram 会造成延迟和内存浪费。
- Consequence: 关系评分必须可追溯到命中 Chunk；扩展算法时继续维持窗口上限和性能测试。
- Revisit only if: 引入离线预计算图索引并证明更低延迟和同等引用准确性。

## 2026-08-04 — 知识地图和工作产物统一保留 sourceRefs
- Decision: 知识地图节点/边、关联文档、笔记、任务和写作草稿共享同一引用模型并保留 `sourceRefs`。
- Reason: 回答后的知识沉淀和行动不能丢失证据链。
- Consequence: 任何“一键转为”能力都必须通过来源保留测试。
- Revisit only if: 引用模型升级并提供兼容迁移。

## 2026-08-04 — NSIS 与 portable 分离构建
- Decision: `npm run desktop:pack` 默认只构建 NSIS；portable 目录和 ZIP 使用独立流程构建与完整性校验。
- Reason: electron-builder 同时压缩超大 `app.asar` 的附加桌面 ZIP 曾长时间卡住并产生损坏文件。
- Consequence: 发布只保留 NSIS 安装器、portable 目录和通过 7-Zip 完整性测试的 portable ZIP；不重新引入损坏桌面 ZIP。
- Revisit only if: 构建工具升级后能稳定、可重复地产生额外桌面 ZIP。

## 2026-08-05 — IMA 式单舞台布局与按需 Context
- Decision: 桌面主壳固定使用 `240px` 中性侧栏、显著“新对话”、单一中心 Composer 与最近内容卡片网格；Context 默认关闭并作为右侧 overlay drawer，仅由用户主动打开，不再随上下文变化自动挤占主区。
- Reason: 用户需要一个排版统一、视觉克制、功能自然联动的飞书版 IMA，而不是顶部导航、搜索和上下文彼此争抢空间的功能集合。
- Consequence: 主导航继续只保留收集、知识库、笔记和 Copilot；品牌色只作重点提示；桌面和移动端布局尺寸、无溢出及 Context 行为由 UI 契约和浏览器证据保护。
- Revisit only if: 新的真实可用性测试证明固定侧栏或 overlay Context 阻碍核心工作流。

## 2026-08-05 — Context 工件统一保留 sourceRefs 并创建后立即 deep-link
- Decision: Ctrl+K/Context 创建的工作工件必须先把当前文档、选区 anchor/offset/quote、显式资源和知识库上下文规范化为去重 `sourceRefs`，持久化成功后立即打开对应持久 Tab；阅读器专用模板可以保留，但不得让统一命令绕过选区来源。
- Reason: 跨模块操作只有在来源链、持久化和落点同时连续时才像一个产品；仅跳转模块或要求用户再次附加来源会割裂工作流。
- Consequence: 新的 Note/Writing/后续工件入口复用统一来源规范化器，并必须以真实浏览器验证 deep-link、来源可见和自动保存。
- Revisit only if: 工件 API 升级为服务端统一上下文对象并提供兼容迁移。

## 2026-08-05 ? ??????????????
- Decision: ? `901px` ?????????????? `204?216px`?Notes/Writing ????? `220?240px`?Analysis/Copilot ???? `240?300px`?????????????????????????????? intrinsic width + nowrap?Recording ??????????????
- Reason: ?????????????????????????????????????????? padding ????????????
- Consequence: ????????????????????????????????????????????????
- Revisit only if: ????????????????????????????????????????

## 2026-08-05 ? Context writing artifacts preserve sourceRefs and deep-link immediately
- Decision: Context and Ctrl+K writing creation must normalize the same source refs as notes, persist the draft first, then open the exact persisted draft in a Writing tab.
- Reason: Navigation-only module switching breaks provenance and makes the product feel like disconnected pages.
- Consequence: Writing autosave must preserve refs, and future writing UI must expose/open those sources.
- Revisit only if: a server-owned unified artifact API supersedes note/writing-specific creation with compatible migration.
## 2026-08-05 — 上下文 AI 动作必须在当前工作表面内就地出现并显式落到目标 Tab
- Decision: 阅读器和知识观察直接呈现与当前文档、选区或节点相关的 AI 问题和工件动作；触发后必须关闭遮挡层、打开准确的持久化问答/笔记/写作 Tab，并保留 sourceRefs、quote、anchor 和 offsets。
- Reason: 单独存在的问答、笔记、写作和图谱功能仍会让用户反复跳页、重新选材料；IMA 式体验依赖动作出现的位置、上下文携带和落点连续性同时成立。
- Consequence: 新页面不能只放“前往某模块”；必须优先复用统一上下文创建/提问入口，并通过真实浏览器证明目标表面可见、可返回且来源不丢失。
- Revisit only if: 后续引入统一浮层助手且能在不遮挡目标内容的情况下提供等价或更短的操作路径。

## 2026-08-05 — Task artifacts stay in the existing Composer/Skill flow; blog, image generation and PPT are excluded
- Decision: Research reports and generated podcasts are invoked from the current Composer or contextual Skill flow and render their persisted files, player and sources in the same conversation/Skill surface. Blog, AI image generation and PPT/presentation generation are explicitly excluded.
- Reason: The user requires IMA-like natural integration and explicitly rejected extra sections, blog, image generation and PPT. A new task dashboard would recreate the same fragmented product problem.
- Consequence: Future parity work must reuse current Reader, Composer, Notes, Knowledge and persistent-tab surfaces. New navigation or independent boards require direct user approval. Podcast must continue producing a real playable/downloadable audio file and preserving sourceRefs/selection anchors.
- Revisit only if: the user explicitly changes these exclusions or IMA's existing information architecture requires a different in-context placement.

## 2026-08-05 — Document interpretation stays inside the Reader as a container-responsive sidecar
- Decision: 思维导图和互动测验只从 Reader 的横向 AI 操作条触发，并在当前文档右侧 sidecar 中呈现；产物持久化到 Skill 历史，默认重开已有结果，显式“重新生成”才创建新运行。1440 宽度保留目录、正文和 sidecar 三栏，Reader 容器变窄时收起目录并保持正文与 sidecar 横向并排。
- Reason: 用户要求照 IMA 的自然融合方式工作，不能把文档解读拆成新的导航页面；1180 实测也证明仅按 viewport 响应会造成 Reader 内部横向滚动，必须按实际容器宽度调整。
- Consequence: 后续 Reader 工件继续复用同一 sidecar/history/source-return 协议，必须保存 sourceRefs、quote、anchor 和 offsets；桌面验收同时检查 body 与 Reader 自身 scrollWidth。
- Revisit only if: 真实可用性测试证明 sidecar 遮挡核心文档，或统一跨表面 AI 助手能够以更短路径提供等价的持久历史和精确回源。

## 2026-08-05 — Notes attachments reuse hidden note content items and stay inside the editor
- Decision: Each JSON-state note is mirrored to a hidden `contentType: note` repository item with the same ID when created, edited or first used for attachments. Local image/file bytes are persisted in the existing SQLite `attachments`/`attachment_blobs` domain and served only through note-scoped inline/download routes. The existing Notes Markdown toolbar performs cursor insertion, read mode renders images/files, and the current relation panel lists attachments beside sources and links.
- Reason: The attachment table has a required `content_item_id` foreign key, while base64/temporary URLs would fail persistence and reopen. Reusing the existing content repository gives real blobs, ownership checks and lifecycle behavior without creating a media board or another storage subsystem.
- Consequence: Notes PATCH/create must keep the hidden note owner synchronized, deletion soft-deletes the owner, attachment reads verify note ownership, autosave must preserve sourceRefs, and desktop acceptance must verify cursor insertion, no-upload reopen, inline/download behavior and horizontal layout at 1440/1180.
- Revisit only if: Notes migrate fully from JSON state to the content repository with a compatible attachment/sourceRefs migration, or a server-owned unified artifact domain supersedes note-specific routes.
## 2026-08-06 — 共享飞书知识库嵌入现有 Knowledge 侧栏
- Decision: 将飞书空间发现结果与 SQLite repository spaces 合并为 `knowledge/libraries` 投影；共享库的发现、关注和当前库选择都从现有横向 Knowledge 侧栏进入。
- Reason: 用户要的是 IMA 式自然融合，而不是独立广场、顶级导航或协作后台；打开共享库必须继续使用原有文档列表、Reader、问答、来源上下文和 sourceRefs。
- Consequence: state 只保存 `discovered/followedIds/refreshedAt`，owner/memberRole/permission 未从飞书返回时保持 `null`；文档过滤用真实 `spaceId` 映射到 canonical library id，关注与 active library 可重载恢复。
## 2026-09-03 — 本地快回先于模型，流式增量合并绘制
- Decision: 问候、确认、口头问题记录等本地快回在检查模型渠道之前完成；可见回答的 token delta 在工作区按约 32ms 合并后再绘制。知识问题仍要求已配置模型，空检索继续拒答。
- Reason: 用户要的流畅感首先来自首屏状态和打字节奏，而不是每个 token 一次 React 更新；模型余额不足时也不该让「你好」失败。
- Consequence: Agent 开始事件可以不含上游模型；聊天、阅读器和文档分析共用 `stream-events` 批处理器。压力测试锁定检索 P95、并行会话隔离和拒答。
- Revisit only if: 实测证明合并窗口造成可感知延迟，或本地快回误伤了需要检索的短问句。

## 2026-08-26 — 问题记录、内嵌网页剪藏、笔记内写回
- Decision: Keep the FlowMind shell. Add `artifactKind: 'problem'` as a separate note type. Embedded browser clips into the current or a new problem record with sourceRefs. Note assistant writes the pitfall, not an encyclopedia, without copy-paste.
- Reason: User-locked product decisions for deep optimization; precipitation in the AI era is the exception, not the full recipe.
- Consequence: Old notes stay. Private/localhost URLs are blocked. Extra QA sections such as 关联资料 must survive write-back.
- Revisit only if: user changes the shell, note-type, or browser decisions.