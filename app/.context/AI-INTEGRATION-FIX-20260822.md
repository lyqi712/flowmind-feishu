# AI 体验与集成（2026-08-22）

只修会伤使用体验的接缝，不做无意义微优化。

## 修了什么

1. **图谱 / 指定文档提问不再被首页清空**  
   首页 QuickAsk 仍不锁上次打开的文档。从图谱节点、阅读器带 `currentDocument` 进来的提问会保留节点和相邻资料。

2. **新开对话 tab 不再串到上一会话**  
   图谱/工作区 `ask(tab.id)` 把该 tab 的 conversationId 传给 `/api/agent/run`。新 tab 没有会话时开新会话，不复用当前 React state 里的旧 id。

3. **确认写入后的范围**  
   已选资料时，笔记和收回的飞书文档会进入下一句范围。全库对话不突然锁死一篇。

4. **查阅过程中文**  
   compare / timeline / extract / draft / keywords / breakdown 不再露出工具原名。

## 有意没动

- 阅读器选区问答仍走 `/api/chat/stream`（页码、时间锚点、流式 delta）
- 主对话仍走 `/api/agent/run`（工具、确认写入、autoRead）
- 不把 AgentCore 接进主路径
