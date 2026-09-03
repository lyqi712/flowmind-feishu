# 优化收束（2026-08-22）

## 本轮真实改动

1. **state.json 紧凑写入**  
   `JsonStateStore.persist` 去掉 pretty-print。28MB 活库每次写盘少大量空白和 stringify 时间。

2. **快答 run 瘦身**  
   `completeLocalRun` 对 `fastReply` 丢掉 evidence/tools/capabilities/plan。  
   agent.runs 上限 200 → 80。

3. **对抗套件对齐产品行为**  
   FakeModel 支持函数 answer，streamGenerate 走同一路径。  
   T3.1 允许 fail-closed（禁止编造 Mallory）。  
   T5.2 补练习文档，避免空库追问被 empty_retrieval 挡住。  
   RED-TEAM 正则覆盖「没有这个数据」。

## 测试

```
node --test tests/agent-runtime.test.mjs tests/agent-api.test.mjs tests/retrieval-policy.test.mjs tests/adversarial-ai-robustness.test.mjs tests/workspace-sync-api.test.mjs
```

**51 pass / 0 fail**，含对抗套件 18/18。

## 仍不拆的（有意）

- 不把 conversations/agent.runs 拆成多文件（要迁存储、改备份/同步）
- 不把 AgentCore 接进 `/api/agent/run`
- 不重打安装包
