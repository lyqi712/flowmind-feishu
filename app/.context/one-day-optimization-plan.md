# 飞书知识库一天完整优化计划

**制定时间**: 2026-08-14 11:28  
**执行时间**: 2026-08-14 全天（约 8 小时）  
**目标**: 完成产品从"信息聚合层"到"决策支持层"的核心转型  

---

## 总体目标

### 核心转型
从"知识库助手"→"决策支持系统"

### 必达成果
1. ✅ 3 个场景化 Skill（Q2 规划、技术选型、客户提案）
2. ✅ 智能首屏（今日待办 + 推荐操作）
3. ✅ 飞书输出 MVP（Markdown → 飞书文档）
4. ✅ 可视化推理链（展示 AI 推理过程）
5. ✅ 全量测试通过（389+ 测试）
6. ✅ 对抗性审查通过

---

## 时间分配（8 小时）

| 时段 | 任务 | 工时 | 优先级 |
|-----|------|------|--------|
| **09:00-10:30** | 阶段 1: 场景化 Skill (Q2 规划) | 1.5h | 🔴 P0 |
| **10:30-12:00** | 阶段 2: 场景化 Skill (技术选型 + 客户提案) | 1.5h | 🔴 P0 |
| **12:00-13:00** | 🍱 午休 | - | - |
| **13:00-14:30** | 阶段 3: 智能首屏 | 1.5h | 🔴 P0 |
| **14:30-16:00** | 阶段 4: 飞书输出 MVP | 1.5h | 🔴 P0 |
| **16:00-17:00** | 阶段 5: 可视化推理链 | 1h | 🟡 P1 |
| **17:00-18:00** | 阶段 6: 集成测试 + 对抗性审查 | 1h | 🔴 P0 |

**总计**: 8 小时

---

## 阶段 1: 场景化 Skill - Q2 规划（1.5h）

### 目标
实现第一个场景化 Skill，验证技术路线

### 具体任务

#### 1.1 定义 Skill 元数据（15min）
**文件**: `server/skills.mjs`

**新增**:
```javascript
{
  id: 'q2-planning',
  name: '生成 Q2 规划',
  description: '基于 Q1 复盘、用户反馈和竞品动态生成 Q2 产品规划草稿',
  category: 'decision-support',
  icon: '📊',
  steps: ['选择输入文档', '提取关键信息', '生成规划草稿'],
  inputs: {
    q1Review: { 
      type: 'document', 
      label: 'Q1 复盘文档', 
      description: '包含 Q1 目标达成情况、经验教训',
      required: true 
    },
    userFeedback: { 
      type: 'documents', 
      label: '用户反馈', 
      description: '用户访谈、调研报告、反馈汇总',
      required: true,
      minCount: 1,
      maxCount: 10
    },
    competitors: { 
      type: 'documents', 
      label: '竞品分析', 
      description: '竞品动态、功能对比',
      optional: true,
      maxCount: 5
    }
  }
}
```

#### 1.2 编写提示词模板（30min）
**新增函数**: `q2PlanningPrompt(documents, inputs)`

```javascript
function q2PlanningPrompt(documents, inputs) {
  const { q1Review, userFeedback, competitors } = inputs;
  
  return `你是产品规划专家，正在帮助团队制定 Q2 产品规划。

输入材料：
- Q1 复盘：${q1Review.title}
- 用户反馈：${userFeedback.length} 份文档
${competitors.length ? `- 竞品分析：${competitors.length} 份文档` : ''}

任务：生成可直接使用的 Q2 产品规划草稿

必须包含以下结构：

# Q2 产品规划

## 执行摘要（150-200 字）
- Q1 核心成果：[从 Q1 复盘提取]
- Q2 战略目标：[基于用户反馈 + 竞品差距]
- 预期影响：[量化指标]

## 核心功能优先级（Top 5）
### 1. [功能名称]
- **用户需求**：[来自用户反馈，引用 [n]]
- **竞品对比**：[来自竞品分析，引用 [n]]
- **预期价值**：[用户影响 + 商业价值]
- **资源需求**：[人力 + 时间，标注"待确认"]
- **风险**：[技术/市场/资源风险]

## 资源规划
- 研发人力：[待确认]
- 设计人力：[待确认]
- 时间窗口：Q2 (4-6 月)

## 关键里程碑
- 4 月：[待确认]
- 5 月：[待确认]
- 6 月：[待确认]

## 风险与应对
1. **技术风险**：[识别的技术难点]
   - 应对：[预案]
2. **市场风险**：[竞品/需求变化]
   - 应对：[预案]

## 待决策事项
1. [需要高层决策的问题]
2. [需要补充的信息]

---
**注意事项**：
1. 所有事实必须有引用 [n]
2. 优先级排序基于：用户价值 > 商业价值 > 实现成本
3. 数字标注来源或"待确认"
4. 不编造不在证据中的信息

证据材料：
${skillEvidence(documents)}`;
}
```

#### 1.3 实现 Skill 执行逻辑（30min）
**修改**: `executeSkill` 函数

```javascript
export async function* executeSkill(skillId, documents, input = {}, { modelService, signal } = {}) {
  // ...existing code...
  
  if (skill.id === 'q2-planning') {
    const q1Review = documents.find(d => d.id === input.q1ReviewId);
    const userFeedback = documents.filter(d => input.userFeedbackIds?.includes(d.id));
    const competitors = documents.filter(d => input.competitorIds?.includes(d.id));
    
    if (!q1Review || !userFeedback.length) {
      throw new Error('Q2 规划需要 Q1 复盘文档和至少 1 份用户反馈');
    }
    
    const prompt = q2PlanningPrompt(documents, { q1Review, userFeedback, competitors });
    
    // 流式生成
    for await (const delta of modelService.streamGenerate({
      system: '你是产品规划专家。只使用给定证据，输出简体中文 Markdown；保留 [n] 引用；不编造信息。',
      prompt,
      signal
    })) {
      // ...流式输出...
    }
  }
}
```

#### 1.4 单元测试（15min）
**新增**: `tests/q2-planning-skill.test.mjs`

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSkill } from '../server/skills.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

test('q2-planning skill generates structured planning document', async () => {
  const modelService = createFakeModelService();
  const documents = [
    { id: 'q1', title: 'Q1 复盘', content: 'Q1 目标完成 85%...' },
    { id: 'fb1', title: '用户反馈汇总', content: '移动端需求 23 次提及...' }
  ];
  
  const input = {
    q1ReviewId: 'q1',
    userFeedbackIds: ['fb1']
  };
  
  let artifact;
  for await (const event of executeSkill('q2-planning', documents, input, { modelService })) {
    if (event.type === 'artifact') artifact = event.artifact;
  }
  
  assert(artifact);
  assert(artifact.content.includes('# Q2 产品规划'));
  assert(artifact.content.includes('执行摘要'));
  assert(artifact.content.includes('核心功能优先级'));
  assert(artifact.sourceRefs.length >= 2);
});
```

### 验收标准
- ✅ Skill 元数据正确注册
- ✅ 提示词包含完整结构要求
- ✅ 流式生成正常工作
- ✅ 单元测试通过
- ✅ 生成的规划包含所有必需章节

---

## 阶段 2: 场景化 Skill - 技术选型 + 客户提案（1.5h）

### 目标
复制 Q2 规划模式，快速实现另外 2 个场景

### 具体任务

#### 2.1 技术选型 Skill（45min）
**Skill ID**: `tech-selection`

**提示词要点**:
```
输入：需求文档 + 技术调研报告 + 历史案例

输出结构：
# 技术选型方案

## 执行摘要
- 选型目标
- 推荐方案
- 关键权衡

## 候选方案对比（表格）
| 方案 | 优势 | 劣势 | 适用场景 | 风险 |
|-----|------|------|---------|------|
| ...

## 推荐方案：[方案名]
- 推荐理由（3-5 点，带引用）
- 实施路径
- 风险应对

## 决策树
- 如果 [条件 A]，选择 [方案 1]
- 如果 [条件 B]，选择 [方案 2]

## 待验证问题
```

#### 2.2 客户提案 Skill（45min）
**Skill ID**: `customer-proposal`

**提示词要点**:
```
输入：产品文档 + 客户背景 + 竞品信息

输出结构：
# [客户名称]专属解决方案

## 客户痛点分析
- 痛点 1：[来自客户背景]
  - 当前方案的问题
  - 业务影响

## 解决方案
- 针对痛点 1：[产品能力 X]
  - 价值：[量化收益]
  - 案例：[类似客户]

## 竞争优势
- 对比竞品 A：[差异点]
- 对比竞品 B：[差异点]

## 实施计划
- POC 阶段（2 周）
- 试点阶段（1 月）
- 全面上线（3 月）

## 投资回报
- 成本：[许可 + 实施 + 培训]
- 收益：[效率提升 + 成本节省]
- ROI：[待确认]
```

### 验收标准
- ✅ 2 个 Skill 元数据注册
- ✅ 提示词结构完整
- ✅ 单元测试通过
- ✅ 3 个场景化 Skill 全部可用

---

## 阶段 3: 智能首屏（1.5h）

### 目标
降低用户启动成本，从 30 秒 → 5 秒

### 具体任务

#### 3.1 数据层 - 今日待办（30min）
**新增**: `server/workspace-home.mjs`

```javascript
export function getTodayTodos({ state, userId, workspaceId }) {
  const todos = [];
  
  // 1. 未完成笔记（最近 3 天有编辑）
  const recentNotes = state.notes
    .filter(note => !note.completed && isRecent(note.updatedAt, 3))
    .slice(0, 3);
  
  todos.push(...recentNotes.map(note => ({
    id: `note-${note.id}`,
    type: 'continue-editing',
    title: `继续编辑《${note.title}》`,
    detail: `${formatTime(note.updatedAt)} 保存`,
    action: { type: 'open-note', noteId: note.id }
  })));
  
  // 2. 文档变更（你的笔记基于旧版本）
  const staleNotes = state.notes
    .filter(note => {
      const sourceDoc = state.documents.find(d => d.id === note.sourceDocumentId);
      return sourceDoc && sourceDoc.updatedAt > note.createdAt;
    })
    .slice(0, 2);
  
  todos.push(...staleNotes.map(note => ({
    id: `stale-${note.id}`,
    type: 'document-updated',
    title: `审阅《${note.sourceDocument.title}》`,
    detail: `⚠️ ${formatDate(note.sourceDocument.updatedAt)} 更新，你的笔记基于旧版本`,
    action: { type: 'compare-versions', noteId: note.id, documentId: note.sourceDocumentId }
  })));
  
  // 3. 未读评论（如果未来有协作功能）
  
  return todos;
}
```

#### 3.2 数据层 - 推荐操作（30min）
**新增**: `getRecommendedActions`

```javascript
export function getRecommendedActions({ state, userId, recentActivity }) {
  const recommendations = [];
  
  // 1. 基于最近打开的文档推荐 Skill
  const recentDocs = recentActivity.filter(a => a.type === 'open-document').slice(0, 5);
  const docTitles = recentDocs.map(a => a.document.title).join(' ');
  
  if (/Q1|复盘|总结/i.test(docTitles)) {
    recommendations.push({
      id: 'rec-q2-planning',
      type: 'skill',
      icon: '📊',
      title: '生成 Q2 规划',
      reason: '你最近查看了 Q1 复盘相关文档',
      action: { type: 'open-skill', skillId: 'q2-planning' }
    });
  }
  
  // 2. 文档更新提醒
  const updatedDocs = state.documents
    .filter(d => isToday(d.updatedAt))
    .slice(0, 3);
  
  if (updatedDocs.length) {
    recommendations.push({
      id: 'rec-updated-docs',
      type: 'notification',
      icon: '🔍',
      title: `查看 ${updatedDocs.length} 份今日更新文档`,
      action: { type: 'filter-documents', filter: 'updated-today' }
    });
  }
  
  // 3. 知识图谱推荐
  const currentNote = recentActivity.find(a => a.type === 'editing-note')?.note;
  if (currentNote) {
    const relatedDocs = findRelatedDocuments(currentNote, state.documents);
    if (relatedDocs.length) {
      recommendations.push({
        id: 'rec-related',
        type: 'document-suggestion',
        icon: '💡',
        title: `你可能需要《${relatedDocs[0].title}》`,
        reason: `来完成《${currentNote.title}》`,
        action: { type: 'open-document', documentId: relatedDocs[0].id }
      });
    }
  }
  
  return recommendations;
}
```

#### 3.3 UI 组件（30min）
**新增**: `src/components/SmartHomePage.jsx`

```jsx
export function SmartHomePage({ todos, recommendations, recentDocs, onAction }) {
  return (
    <div className="smart-home-page">
      {todos.length > 0 && (
        <Section title="今日待办" icon="📋">
          {todos.map(todo => (
            <TodoCard key={todo.id} {...todo} onClick={() => onAction(todo.action)} />
          ))}
        </Section>
      )}
      
      {recommendations.length > 0 && (
        <Section title="推荐操作" icon="✨">
          {recommendations.map(rec => (
            <RecommendationCard key={rec.id} {...rec} onClick={() => onAction(rec.action)} />
          ))}
        </Section>
      )}
      
      <Section title="最近使用" icon="🕒">
        {recentDocs.map(doc => (
          <DocumentCard key={doc.id} {...doc} onClick={() => onAction({ type: 'open-document', documentId: doc.id })} />
        ))}
      </Section>
    </div>
  );
}
```

### 验收标准
- ✅ 今日待办正确识别未完成笔记和过期文档
- ✅ 推荐操作基于用户行为
- ✅ UI 清晰展示 3 个区块
- ✅ 点击操作正确跳转
- ✅ 启动成本 < 10 秒（手动测试）

---

## 阶段 4: 飞书输出 MVP（1.5h）

### 目标
实现 Markdown → 飞书文档的基础能力

### 具体任务

#### 4.1 Markdown → 飞书 Block 转换（45min）
**新增**: `server/feishu-export.mjs`

```javascript
export function markdownToFeishuBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // 标题
    if (/^(#{1,6})\s+(.+)$/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      const level = match[1].length;
      const text = match[2];
      blocks.push({
        block_type: 1, // heading
        heading: {
          elements: [{ text_run: { content: text } }],
          style: { headingLevel: level }
        }
      });
      i++;
      continue;
    }
    
    // 列表
    if (/^[-*+]\s+(.+)$/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+(.+)$/.test(lines[i])) {
        const match = lines[i].match(/^[-*+]\s+(.+)$/);
        items.push(match[1]);
        i++;
      }
      blocks.push({
        block_type: 4, // bullet
        bullet: {
          elements: items.map(text => ({ text_run: { content: text } }))
        }
      });
      continue;
    }
    
    // 表格（简化版）
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(createFeishuTable(tableLines));
      continue;
    }
    
    // 普通段落
    if (line.trim()) {
      blocks.push({
        block_type: 2, // text
        text: {
          elements: [{ text_run: { content: line } }]
        }
      });
    }
    
    i++;
  }
  
  return blocks;
}
```

#### 4.2 飞书 API 调用（30min）
**新增**: `createFeishuDocument`

```javascript
export async function createFeishuDocument({ 
  title, 
  markdown, 
  tenantToken, 
  spaceId 
}) {
  const blocks = markdownToFeishuBlocks(markdown);
  
  const response = await fetch('https://open.feishu.cn/open-api/docx/v1/documents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tenantToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      folder_token: spaceId,
      title,
      content: { blocks }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw Object.assign(
      new Error(`飞书文档创建失败: ${error.msg || response.statusText}`),
      { code: 'FEISHU_CREATE_FAILED', status: response.status, details: error }
    );
  }
  
  return await response.json();
}
```

#### 4.3 UI 集成（15min）
**修改**: `src/components/SkillResult.jsx`

```jsx
<Toolbar>
  <Button onClick={handleCopy}>
    <Copy size={16} />
    复制
  </Button>
  
  <Button onClick={handleExportToFeishu} disabled={!feishuConnected}>
    <Upload size={16} />
    输出到飞书
  </Button>
  
  <Button onClick={handleSaveAsNote}>
    <Save size={16} />
    存为笔记
  </Button>
</Toolbar>
```

### 验收标准
- ✅ Markdown → 飞书 Block 转换正确（标题、列表、段落）
- ✅ API 调用成功创建文档
- ✅ 错误处理完整（无权限、网络错误）
- ✅ UI 按钮可用，点击后显示成功提示

---

## 阶段 5: 可视化推理链（1h）

### 目标
展示 AI 推理过程，提升可解释性

### 具体任务

#### 5.1 服务端推理步骤（30min）
**修改**: `server/app.mjs` - `/api/chat/stream`

```javascript
// 在流式生成前，先输出推理步骤
yield { 
  type: 'reasoning-step', 
  step: 1, 
  title: '搜索相关文档', 
  status: 'in_progress' 
};

const searchResults = await searchDocuments(question, allDocuments);

yield { 
  type: 'reasoning-step', 
  step: 1, 
  status: 'completed',
  detail: `找到 ${searchResults.length} 份相关文档`,
  data: searchResults.map(r => ({ 
    title: r.document.title, 
    relevance: r.score 
  }))
};

yield { 
  type: 'reasoning-step', 
  step: 2, 
  title: '提取关键信息', 
  status: 'in_progress' 
};

// ... 提取逻辑 ...

yield { 
  type: 'reasoning-step', 
  step: 2, 
  status: 'completed',
  detail: `提取了 ${keyPoints.length} 个关键点`,
  data: keyPoints
};

yield { 
  type: 'reasoning-step', 
  step: 3, 
  title: '综合判断', 
  status: 'in_progress' 
};

// 开始流式生成答案
for await (const delta of modelService.streamGenerate(...)) {
  // ...
}

yield { 
  type: 'reasoning-step', 
  step: 3, 
  status: 'completed' 
};
```

#### 5.2 前端推理链展示（30min）
**新增**: `src/components/ReasoningChain.jsx`

```jsx
export function ReasoningChain({ steps, expanded, onToggle }) {
  return (
    <div className="reasoning-chain">
      <button 
        className="reasoning-chain-toggle" 
        onClick={onToggle}
      >
        {expanded ? '收起' : '展开'} AI 推理过程
        <ChevronDown className={expanded ? 'rotated' : ''} />
      </button>
      
      {expanded && (
        <ol className="reasoning-steps">
          {steps.map(step => (
            <li key={step.step} className={`step-${step.status}`}>
              <div className="step-header">
                {step.status === 'completed' && <CheckCircle size={16} />}
                {step.status === 'in_progress' && <LoaderCircle size={16} className="spinning" />}
                <span className="step-title">{step.title}</span>
              </div>
              
              {step.detail && (
                <div className="step-detail">{step.detail}</div>
              )}
              
              {step.data && (
                <div className="step-data">
                  {Array.isArray(step.data) ? (
                    <ul>
                      {step.data.map((item, i) => (
                        <li key={i}>
                          {typeof item === 'object' 
                            ? `${item.title} (相关度 ${Math.round(item.relevance * 100)}%)`
                            : item
                          }
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <pre>{JSON.stringify(step.data, null, 2)}</pre>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

### 验收标准
- ✅ 服务端正确输出推理步骤事件
- ✅ 前端展示推理链（默认收起）
- ✅ 点击展开/收起正常工作
- ✅ 推理步骤清晰易懂

---

## 阶段 6: 集成测试 + 对抗性审查（1h）

### 目标
确保所有新功能集成正常，边界场景通过

### 具体任务

#### 6.1 集成测试（30min）

**新增测试**:
1. `tests/scene-skills-integration.test.mjs` - 场景化 Skill 端到端测试
2. `tests/smart-home-integration.test.mjs` - 智能首屏数据正确性
3. `tests/feishu-export-integration.test.mjs` - 飞书输出完整流程

**运行**:
```bash
cd /d/luxiaofei/ima-feishu/app
node --test tests/*.test.mjs
```

**目标**: 全部测试通过（预计 400+ 测试）

#### 6.2 对抗性审查（30min）

**场景清单**:

##### A. 场景化 Skill
- [ ] A1. 缺少必需输入 → 显示明确错误
- [ ] A2. 输入文档为空 → 提示"文档无内容"
- [ ] A3. 模型不可用 → 显示 502 错误，不伪造答案
- [ ] A4. 生成中取消 → 中止干净，无残留状态
- [ ] A5. 生成结果包含所有必需章节 → 结构完整
- [ ] A6. 引用编号正确 → [1][2][3] 对应 sourceRefs

##### B. 智能首屏
- [ ] B1. 新用户无历史 → 显示欢迎页 + 快速开始
- [ ] B2. 今日无待办 → 只显示推荐操作 + 最近使用
- [ ] B3. 点击待办项 → 正确跳转到笔记/文档
- [ ] B4. 推荐操作基于错误行为 → 不显示无关推荐
- [ ] B5. 刷新页面 → 智能首屏立即可用（< 2 秒）

##### C. 飞书输出
- [ ] C1. 未配置飞书 → 提示需要配置，引导授权
- [ ] C2. 无权限创建文档 → 显示权限错误
- [ ] C3. Markdown 包含复杂表格 → 正确转换
- [ ] C4. 导出成功 → 显示飞书链接，可直接打开
- [ ] C5. 网络错误 → 提示重试，不丢失内容

##### D. 可视化推理链
- [ ] D1. 推理链默认收起 → 不影响阅读
- [ ] D2. 展开推理链 → 所有步骤清晰可读
- [ ] D3. 推理中取消 → 推理链停止更新
- [ ] D4. 推理失败 → 显示失败步骤 + 原因

##### E. 回归验证
- [ ] E1. 原有总结功能 → 正常工作
- [ ] E2. 文档阅读器 → 不受影响
- [ ] E3. 知识图谱 → 正常显示
- [ ] E4. 普通问答 → 不显示推理链（仅场景化 Skill）

**执行方式**:
1. 手动浏览器测试（关键路径）
2. 自动化测试覆盖（边界场景）

### 验收标准
- ✅ 全量测试通过（400+ 测试）
- ✅ 对抗性审查 20/20 通过
- ✅ 关键用户路径流畅（启动 < 5 秒，操作响应 < 1 秒）

---

## 风险与应对

### 风险 1: 时间不足
**概率**: 中  
**影响**: 高  
**应对**: 
- 优先保证 P0 功能（场景化 Skill + 智能首屏）
- P1 功能（推理链）可降级为简化版
- 预留 1 小时缓冲时间

### 风险 2: 飞书 API 权限问题
**概率**: 高  
**影响**: 中  
**应对**:
- 准备降级方案：复制到剪贴板 + 手动粘贴
- 文档说明权限配置流程
- 错误提示引导用户授权

### 风险 3: 模型调用失败
**概率**: 低  
**影响**: 高  
**应对**:
- 所有测试使用 fake-model
- 实际调用前检查模型配置
- 失败时显示明确错误 + 重试按钮

### 风险 4: 测试覆盖不足
**概率**: 中  
**影响**: 中  
**应对**:
- 新功能至少 1 个单元测试 + 1 个集成测试
- 对抗性审查手动执行关键场景
- 记录已知问题，后续修复

---

## 交付检查清单

### 代码交付
- [ ] 3 个场景化 Skill 实现完整
- [ ] 智能首屏数据层 + UI 层
- [ ] 飞书输出 Markdown 转换 + API 调用
- [ ] 可视化推理链（服务端 + 前端）
- [ ] 所有新代码有注释

### 测试交付
- [ ] 单元测试（每个新功能 ≥1 个）
- [ ] 集成测试（端到端流程）
- [ ] 对抗性审查清单（20 个场景）
- [ ] 测试通过率 100%

### 文档交付
- [ ] 功能使用文档（用户视角）
- [ ] 技术实现文档（开发视角）
- [ ] 已知问题清单
- [ ] 后续优化建议

---

## 成功标准

### 必达指标
1. ✅ 全量测试通过（400+ 测试）
2. ✅ 对抗性审查通过（20/20 场景）
3. ✅ 3 个场景化 Skill 可用
4. ✅ 智能首屏启动 < 10 秒
5. ✅ 飞书输出基础功能可用

### 体验指标
1. ✅ 用户启动成本 < 10 秒（目标 5 秒）
2. ✅ 场景化 Skill 生成时间 < 30 秒
3. ✅ 飞书输出成功率 > 95%
4. ✅ 推理链展开响应 < 500ms

### 质量指标
1. ✅ 代码覆盖率 > 80%
2. ✅ 无 P0 级别缺陷
3. ✅ P1 缺陷 < 3 个
4. ✅ 所有 API 有错误处理

---

## 计划总结

**总工时**: 8 小时  
**核心功能**: 4 个（场景化 Skill、智能首屏、飞书输出、推理链）  
**测试覆盖**: 单元 + 集成 + 对抗性  
**风险应对**: 4 个主要风险，均有预案  

**关键里程碑**:
- 12:00 - 完成场景化 Skill
- 14:30 - 完成智能首屏
- 16:00 - 完成飞书输出
- 17:00 - 完成推理链
- 18:00 - 通过所有测试和审查

**预期成果**:
- 产品从"信息聚合"→"决策支持"核心转型
- 用户启动成本降低 80%（30 秒 → 5 秒）
- 用户满意度提升到 85%+

---

**计划制定人**: Kiro (Proma Agent)  
**制定时间**: 2026-08-14 11:28  
**计划状态**: 待审批
