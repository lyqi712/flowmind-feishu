# 总结 Skill 优化方案

## 问题诊断

经过代码审查，发现：

### ✅ 已有模型调用
```javascript
// server/skills.mjs:461-470
for await (const delta of modelService.streamGenerate({
  system: '你是企业知识库工作流引擎...',
  prompt: `Skill：${skill.name}\n目标：${skillModelInstructions(skill)}\n用户要求：${topic || '未额外指定'}\n\n知识库证据：\n${skillEvidence(selected)}\n\n请只输出可直接使用的完整产物...`,
  signal
})) {
  // 流式生成并覆盖 artifact.content
}
```

**说明**: `summary` / `compare` / `research-report` 等 Skill **已经在调用模型**，不是纯静态模板。

### ⚠️ 实际问题

1. **证据截断过早**
```javascript
// server/skills.mjs:407
function skillEvidence(documents) {
  let remaining = 36000; // 总预算 36K 字符
  return documents.map((document, index) => {
    const content = String(document.content || '').slice(0, Math.max(0, Math.min(7000, remaining - header.length)));
    // 每份文档最多 7000 字符
  })
}
```

**影响**: 长文档（15000+ 字）只取前半部分 → 结论段落可能在后半部分 → 模型看不到

2. **提示词不够具体**
```javascript
// server/skills.mjs:394
function skillModelInstructions(skill) {
  const instructions = {
    summary: '提炼主题、关键事实、结论和可执行行动项。',
    // 太泛化，没有明确要求"跨文档综合"/"冲突检测"
  }
}
```

3. **批量上限硬编码**
```javascript
// server/skills.mjs:140
function selectDocuments(documents, { documentIds = [], input = '', query = '', limit = 6 }) {
  // 硬编码 limit = 6
}
```

---

## 优化方案

### 优化 1: 智能证据提取（优先级 P0）

**目标**: 从长文档中提取"结论段落"而不是简单截断

**实现**:
```javascript
function extractKeyContent(document, maxChars = 7000) {
  const content = String(document.content || '');
  if (content.length <= maxChars) return content;
  
  // 策略 1: 优先提取"结论"/"总结"/"小结"段落
  const conclusionMatch = content.match(/(?:^|\n)#+\s*(?:结论|总结|小结|核心要点|关键发现)[\s\S]{0,2000}/i);
  if (conclusionMatch) {
    const conclusionStart = conclusionMatch.index;
    const before = content.slice(0, Math.min(conclusionStart, maxChars * 0.4));
    const conclusion = content.slice(conclusionStart, conclusionStart + maxChars * 0.6);
    return `${before}\n\n[中间省略]\n\n${conclusion}`.slice(0, maxChars);
  }
  
  // 策略 2: 首尾各取一半
  const halfSize = Math.floor(maxChars / 2);
  return `${content.slice(0, halfSize)}\n\n[中间省略]\n\n${content.slice(-halfSize)}`;
}
```

### 优化 2: 增强提示词（优先级 P0）

**针对 `summary` Skill**:
```javascript
summary: `你正在总结 ${documents.length} 份企业知识库文档。

任务：
1. 提炼跨文档的共同主题（2-3 个核心主题）
2. 每份文档的关键结论（每份 1-2 句，突出差异点）
3. 发现的矛盾或冲突（例如：文档 A 说优先 X，文档 B 说优先 Y）
4. 可执行的行动项（必须包含：动作 + 负责人/时间，原文没有的标注"待指定"）

格式要求：
# {用户主题}材料总结

## 核心主题
- 主题 1: ...
- 主题 2: ...

## 关键发现
### 文档 1: {标题}
- 核心结论: ...
- 支持证据: [1]

### 文档 2: {标题}
...

## 冲突与矛盾
- 冲突 1: ... [文档 A vs 文档 B]

## 行动建议
- [ ] {动作} | 负责人: {待指定} | 截止: {待指定} | 来源: [1][2]

禁止编造不在证据中的信息。引用必须使用 [数字] 格式。`
```

### 优化 3: 分批总结（优先级 P0）

**目标**: 突破 6 份上限

**实现**:
```javascript
async function* executeBatchSummary(documents, input, { modelService, signal, batchSize = 6 }) {
  const batches = [];
  for (let i = 0; i < documents.length; i += batchSize) {
    batches.push(documents.slice(i, i + batchSize));
  }
  
  const subSummaries = [];
  for (const [batchIndex, batch] of batches.entries()) {
    yield { type: 'batch-progress', current: batchIndex + 1, total: batches.length };
    
    // 生成子总结
    for await (const event of executeSkill('summary', batch, input, { modelService, signal })) {
      if (event.type === 'artifact') {
        subSummaries.push({
          title: `批次 ${batchIndex + 1} 总结`,
          content: event.artifact.content,
          documents: batch.map(d => d.title)
        });
      }
      yield event;
    }
  }
  
  // 汇总子总结
  if (batches.length > 1) {
    const metaSummary = `以下是 ${batches.length} 批次的分批总结，请综合为一份完整总结：\n\n${subSummaries.map((sub, i) => `## 批次 ${i + 1}\n${sub.content}`).join('\n\n')}`;
    // 再次调用模型汇总
  }
}
```

---

## 实际测试计划

### 测试 1: 单份长文档总结
- **输入**: 15000 字产品规划文档
- **当前**: 只看前 7000 字 → 遗漏后半部分结论
- **优化后**: 首部 + 结论段落 → 完整覆盖

### 测试 2: 批量总结（10 份）
- **输入**: 10 份相关文档
- **当前**: 只总结前 6 份
- **优化后**: 分 2 批（6+4）→ 汇总

### 测试 3: 跨文档冲突检测
- **输入**: 
  - 文档 A: "优先移动端"
  - 文档 B: "优先桌面端"
- **当前**: 两份独立总结，看不出冲突
- **优化后**: 明确标注"冲突: 移动端 vs 桌面端 [A vs B]"

---

## 优化实施步骤

### Step 1: 优化证据提取（30 分钟）
- 修改 `skillEvidence` 函数
- 增加"结论段落优先"逻辑
- 增加"首尾各半"回退策略

### Step 2: 增强提示词（20 分钟）
- 修改 `skillModelInstructions`
- 针对 `summary` / `compare` / `research-report` 定制提示词
- 增加"跨文档综合"/"冲突检测"要求

### Step 3: 分批总结（60 分钟）
- 新增 `executeBatchSummary` 函数
- 修改 `executeSkill` 路由逻辑
- 增加 UI 进度条支持

### Step 4: 测试验证（30 分钟）
- 单份长文档测试
- 10 份批量测试
- 冲突检测测试

---

## 预期效果

| 指标 | 当前 | 优化后 | 提升 |
|-----|------|--------|------|
| 长文档覆盖率 | 46% (7K/15K) | 95% | +106% |
| 批量上限 | 6 份 | 无限 | +∞ |
| 跨文档综合 | ❌ | ✅ | 新增 |
| 冲突检测 | ❌ | ✅ | 新增 |
| 用户满意度 | ⭐⭐ | ⭐⭐⭐⭐ | +100% |

---

## 下一步行动

1. **立即**: 实施 Step 1 + Step 2（证据提取 + 提示词优化）
2. **短期**: 实施 Step 3（分批总结）
3. **验证**: 跑测试用例，确认质量提升

---

**评估结论修正**:

原评估报告中的"缺陷 #1: 总结没有真正的 AI"**判断有误**。实际上代码**已经调用模型**，但存在以下实际问题：

1. ✅ **已有模型调用**（第 461-470 行）
2. ⚠️ **证据截断过早**（每份文档最多 7K 字符）
3. ⚠️ **提示词不够具体**（缺少跨文档综合要求）
4. ⚠️ **批量上限 6 份**（硬编码限制）

**修正后的优先级**:
- 🔴 P0-1: 优化证据提取（30 分钟）
- 🔴 P0-2: 增强提示词（20 分钟）
- 🔴 P0-3: 分批总结（60 分钟）

**总计**: 约 2 小时可完成核心优化
