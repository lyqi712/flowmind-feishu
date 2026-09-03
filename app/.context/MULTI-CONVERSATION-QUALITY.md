# 多对话 / 多任务质量（2026-08-22）

## 能力

- 问知识库、对照资料、写笔记/任务/飞书文档、写代码与文件草稿
- 纯代码任务不先扫全库；提到文档才检索
- 写入一律确认后才落盘

## 并行

- 每个对话 tab 自己的 messages / conversationId / abort，切 tab 不会把流式结果写进另一场
- 服务端两场问答 + 一场写代码可以同时跑：范围、答案、待确认写入互不串

## 测试

`tests/agent-parallel-conversations.test.mjs`：runtime 并行隔离 + HTTP 会话 persist 隔离。
