# 不接 Pi Agent SDK（2026-08-22）

以前规划的「Pi Agent 底层」是意图分类 + 多场景工具，不是把 Proma 的 Pi Agent SDK（shell、磁盘、MCP）嵌进 FlowMind。

**结论：不加 Pi Agent SDK。** FlowMind 是知识工作台。通用编程 Agent 已经是 Proma。嵌进去会变成第二套执行环境，还能绕过确认写入。

**做法：扩现有 `runtime.mjs`。**

- 写代码 / 脚本 / 文件 → `draft.create`（可带 fileName、language、kind），确认后进写作台
- 笔记 / 任务 / 飞书文档 → 原有写入工具，仍要确认
- 纯代码任务不先扫全库；提到「文档/资料」时才检索
- change 模式允许按用户要求原创产物，不准假装写进了磁盘或跑了 shell
- `file.write` 仍要用户选定目录，默认不可用
