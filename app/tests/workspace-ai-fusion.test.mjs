import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const streamSource = await readFile(new URL('../src/workspace/stream-events.js', import.meta.url), 'utf8');
const readerSource = await readFile(new URL('../src/components/ContentReader.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../server/app.mjs', import.meta.url), 'utf8');
const copilotSource = await readFile(new URL('../src/components/CopilotWorkspace.jsx', import.meta.url), 'utf8');

test('阅读器提问留在当前文档，不跳到新的问答 Tab', () => {
  for (const fragment of [
    'function handleReaderAsk(prompt, item, selection = null)',
    'async function streamReaderAsk(text, item, selection = null)',
    'void streamReaderAsk(text, item, readerAskSelection(item, selection))',
    'conversation={readerChat.documentId === readerDetail.item.id ? readerChat : null}',
    'onAsk={(prompt, selection) => handleReaderAsk(prompt, readerDetail.item, selection)}',
    'conversationId: existingConversationId || undefined',
    "fetch('/api/agent/run'",
    "surface: 'reader'",
    'readerDocumentId: item.id',
    'includeKnowledgeBase: false',
    'persistReaderConversation(item.id, conversationId)',
    'restoredReaderChat('
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
  assert.doesNotMatch(mainSource, /function handleReaderAsk\([^)]*\) \{\s*handleWorkspaceAsk/);
});

test('无选区问这篇会开新对话 tab 并把当前文档锁进范围', () => {
  for (const fragment of [
    'function hasReaderSelection(selection)',
    'if (!text && !hasReaderSelection(selection))',
    'const documentId = String(item?.id || \'\');',
    'scene: { documentIds: documentId ? [documentId] : [], agentMode: \'auto\' }',
    'void streamReaderAsk(text, item, readerAskSelection(item, selection))'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
  assert.match(mainSource, /onAsk=\{\(prompt, selection\) => handleReaderAsk\(prompt, readerDetail\.item, selection\)\}/);
});

test('服务端阅读器提问会丢掉额外文档并禁止回退全库', () => {
  for (const fragment of [
    'const readerLock = resolveReaderAskLock({',
    'documentIds: readerLock.documentIds',
    'shouldIncludeKnowledgeBase({',
    'readerLocked: Boolean(readerLock)'
  ]) assert.ok(appSource.includes(fragment), `missing ${fragment}`);
});

test('知识观察问题携带节点来源和相邻文档进入统一问答', () => {
  for (const fragment of [
    'function handleKnowledgeObservationAsk(prompt, node, relatedNodes = [])',
    'const explicitDocumentId = String(context?.currentDocument?.documentId || context?.currentDocument?.id || context?.currentDocument?.sourceId || \'\').trim();',
    'const askContext = (onHome && !explicitDocumentId)',
    'const sourceRefs = Array.isArray(node?.raw?.sourceRefs) ? node.raw.sourceRefs : []',
    'item.type === \'document\' || item.type === \'note\'',
    'resources: [...sourceRefs, ...relatedDocuments]',
    'onAskNode={handleKnowledgeObservationAsk}',
    'const conversationForRun = chatTabId',
    'conversationIdOverride'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});

test('阅读选区可直接沉淀为保留 quote、anchor 和 offset 的来源笔记', () => {
  for (const fragment of [
    'async function writeSourceNote(item, selection = null)',
    "quote ? { quote, selection: true, startOffset: selection?.startOffset, endOffset: selection?.endOffset }",
    "tags: quote ? ['来源笔记', '选区笔记'] : ['来源笔记']",
    "summary: quote ? '基于阅读选区创建' : '来源笔记'"
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
});
test('阅读器选区在问答和 Agent 模式都发送给服务器复核，而不是只依赖客户端定位', () => {
  for (const fragment of [
    'async function askAgent(prompt = query, scopeDocumentIds = null, targetAssistantId = \'\', attachmentOverride = null, modeOverride = agentMode, selectionOverride = null, conversationIdOverride, tabIdOverride, scopeExplicitOverride = null)',
    'selection: requestedSelection, conversationId,',
    'return askAgent(prompt, scopeDocumentIds, targetAssistantId, attachmentOverride, mode, selectionOverride, conversationForRun, chatTabId, requestedScopeExplicit);',
    'setMessagesForChatTab(chatTabId,',
    '正在看你划的那段',
    '正在解析 ${activeAttachments.length} 个附件'
  ]) assert.ok(mainSource.includes(fragment), `missing selection workflow fragment: ${fragment}`);
  const askBody = mainSource.slice(mainSource.indexOf('async function ask('), mainSource.indexOf('async function runChatSkill('));
  assert.doesNotMatch(askBody, /\/api\/chat\/stream/);
});

test('阅读器问答与写作默认只携带当前文档，其他资料必须显式加入', () => {
  for (const fragment of [
    'function readerWorkspaceContext(item, selection = null, { includeWorkspaceResources = false } = {})',
    'const resources = includeWorkspaceResources',
    '? (workspaceContext.resources || []).filter',
    ': [];',
    'function handleReaderCreateWriting(item, selection = null)',
    'return handleWorkspaceCreateWriting(readerWorkspaceContext(item, selection))',
    'onCreateWriting={selection => handleReaderCreateWriting(readerDetail.item, selection)}'
  ]) assert.ok(mainSource.includes(fragment), `missing ${fragment}`);
  assert.match(mainSource, /function readerWorkspaceContext[\s\S]*?return \{ currentDocument, selection, resources \};/);
});

test('精简和展开进更多，默认页脚只留记问题和复制', () => {
  assert.doesNotMatch(mainSource, /className="answer-followups"/);
  assert.match(mainSource, /ask\('精简一下'\)/);
  assert.match(mainSource, /ask\('展开说说'\)/);
  assert.match(mainSource, /className="message-more-menu"/);
});

test('主对话回答可点引用，默认只留记问题和复制', () => {
  assert.match(mainSource, /injectCitationNodes/);
  assert.match(mainSource, /citationMarkdownComponents/);
  assert.match(mainSource, /function citationEvidenceList/);
  assert.match(mainSource, /const list = citationEvidenceList\(citations\)/);
  assert.doesNotMatch(mainSource, /citationMarkdownComponents[\s\S]{0,180}uniqueCitationSources/);
  assert.match(mainSource, /把这次容易忘的点记下来/);
  assert.match(mainSource, /aria-label="复制回答"/);
  assert.match(mainSource, /className="message-more-menu"/);
});

test('知识库浏览只找文件，写作和图谱从对话更多或命令进入', () => {
  assert.doesNotMatch(mainSource, /用这个库写作/);
  assert.doesNotMatch(mainSource, /总结这个库/);
  assert.doesNotMatch(mainSource, /打开知识观察/);
  assert.match(mainSource, /library-doc-grid/);
  assert.match(mainSource, /onCreateArtifact\?\.\('writing', message\)/);
  assert.match(mainSource, /handleWorkspaceCreateWriting/);
  assert.match(mainSource, /openKnowledgeGraph/);
});

test('问答范围说的是当前库，不再用含糊的整个知识库', () => {
  assert.match(mainSource, /这次问的范围/);
  assert.match(mainSource, /kb\?\.name \|\| '当前知识库'/);
  assert.match(mainSource, /不限篇目/);
  assert.doesNotMatch(mainSource, /整个知识库/);
});

test('空对话先给 Copilot 开场，不让智能首页把提问入口挤掉', () => {
  assert.match(mainSource, /starterButtons.map/);
  assert.doesNotMatch(mainSource, /读懂一份材料/);
  assert.doesNotMatch(mainSource, /recentHomeItems.length \? <SmartHome compact/);
  assert.match(mainSource, /这个 Copilot 的 Skills/);
  assert.match(mainSource, /id === 'evidence'/);
  assert.doesNotMatch(mainSource, /!messages.some\(message => message.role === 'user'\) && smartHome \? \(/);
});

test('Copilot 配置能绑定知识库、开场问题，并回到问答使用', () => {
  assert.match(copilotSource, /绑定知识库/);
  assert.match(copilotSource, /开场问题/);
  assert.match(copilotSource, /用这个问答/);
  assert.match(copilotSource, /copilot-skills-picker/);
  assert.match(copilotSource, /copilot-bound-skills/);
  assert.match(copilotSource, /添加能力/);
  assert.match(copilotSource, /示例能力/);
  assert.doesNotMatch(copilotSource, /open=\{Boolean\(\(form\.skillIds \|\| \[\]\)\.length\)\}/);
  assert.match(copilotSource, /knowledgeBaseIds/);
  assert.match(mainSource, /copilotId: state.settings\?\.activeCopilotId/);
  assert.match(mainSource, /onUseInChat=\{useCopilotInChat\}/);
  assert.match(mainSource, /WorkspaceSurfaceErrorBoundary/);
  assert.doesNotMatch(copilotSource, /\{\{documentTitle\}\}/);
  assert.doesNotMatch(copilotSource, /\{\{currentDate\}\}/);
});

test('知识库问答把搜索词和已浏览文件嵌在回答里，而不是只放查阅过程面板', () => {
  assert.match(mainSource, /function KnowledgeWorkStrip/);
  assert.match(mainSource, /知识库搜索/);
  assert.match(mainSource, /已浏览/);
  assert.match(mainSource, /mergeKnowledgeWork,/);
  assert.match(mainSource, /我先查看知识库里的资料/);
  assert.match(mainSource, /startEvent.fastReply \? ''/);
  assert.match(mainSource, /createStreamEventBatcher/);
  assert.match(mainSource, /applyAssistantStreamEvent/);
  assert.match(mainSource, /这篇还要注意什么/);
});

test('答完后查阅过程可展开，不把思考链抹掉', () => {
  assert.match(mainSource, /details className="agent-execution-panel is-collapsed"/);
  assert.match(mainSource, /\(message.agent\?\.tools \|\| \[\]\)\.length > 0 \|\| \(message.agent\?\.observations \|\| \[\]\)\.length > 0/);
  assert.match(mainSource, /已查阅 \$\{observations.length\} 处资料/);
});

test('Agent 待确认提案显示可审阅 diff、服务器来源和过期状态', () => {
  for (const fragment of [
    'const proposal = confirmation?.proposal || {}',
    '查看将写入的内容与依据',
    '服务器已观测的依据',
    '有效至',
    '已过期，请重新运行',
    '确认不会跳过服务端的证据、范围、目标版本和提案哈希重验',
    'onOpenDocument?.(source)',
    'disabled={busy || expired}'
  ]) assert.ok(mainSource.includes(fragment), `missing confirmation review fragment: ${fragment}`);
});

test('确认写入后能打开产物并继续用这篇内容', () => {
  for (const fragment of [
    'function openWrittenArtifact(artifact)',
    'onOpenWrittenArtifact={openWrittenArtifact}',
    'onOpenWrittenArtifact={onOpenWrittenArtifact}',
    'agent?.writtenArtifact',
    '打开笔记',
    'const followUpId = artifact.kind === \'feishu\' ? String(artifact.contentItemId || \'\') : (artifact.kind === \'note\' ? String(artifact.id) : \'\')',
    "openCreatedWorkspaceNote({ id: written.id, title: written.title || '笔记' }, { summary: '对话写入知识库' })"
  ]) assert.ok(mainSource.includes(fragment), `missing write-back loop fragment: ${fragment}`);
  for (const fragment of [
    'function currentKnowledgeMaterials(store, content, { includeContent = true, includeNoteContent = includeContent } = {})',
    'function publicWrittenArtifact(result, confirmation = null)',
    'function lastWrittenFromConversation(conversation, store = null)',
    'function lastAssistantAnswerFromConversation(conversation)',
    'function pendingConfirmationIdFromConversation(conversation)',
    'function applyConfirmedWriteToConversation(state, { run, result, confirmation, artifact })',
    'artifact?.kind === \'note\' && artifact.id',
    "origin: 'agent-write'",
    'conversation.lastWritten ='
  ]) assert.ok(appSource.includes(fragment), `missing knowledge write-back fragment: ${fragment}`);
});

test('Agent 流式结果会记下会话，口头确认和改写上一句能接上', () => {
  for (const fragment of [
    'if ((event.type === \'start\' || event.type === \'done\') && event.conversationId) setChatConversationIdForTab(chatTabId, event.conversationId)',
    'createStreamEventBatcher',
    'applyAssistantStreamEvent'
  ]) assert.ok(mainSource.includes(fragment), `missing conversation continuity fragment: ${fragment}`);
  for (const fragment of [
    "if (event.type === 'confirmation-decision')",
    "if (event.type === 'confirmation-applied')",
    'event.result?.writtenArtifact || agent.writtenArtifact'
  ]) assert.ok(streamSource.includes(fragment), `missing stream continuity fragment: ${fragment}`);
});


test('默认 Agent 答完会挂上知识关系，范围和恢复能用到笔记', () => {
  for (const fragment of [
    'const conversationMaterials = useMemo(() => {',
    'const knownDocumentIds = new Set(conversationMaterials.map(item => String(item.id)));',
    'documents={conversationMaterials}',
    'onOpenEvidence?.(draft)',
    'citationIntegrity',
    "fetch('/api/graph?suggestions=true'",
    'async function confirmGraphSuggestion(suggestionId, approved = true, message = null)',
    'onConfirmSuggestion={confirmGraphSuggestion}',
    'onConfirmSuggestion={onConfirmSuggestion}',
    'onRefreshGraph={async () => { invalidateGraphData(); await requestGraphSnapshot(); }}'
  ]) assert.ok(mainSource.includes(fragment), `missing conversation loop fragment: ${fragment}`);
  for (const fragment of [
    'function relationsFromAgentResult(result, { materials = [], fallbackDocuments = [], question = \'\', history = [] } = {})',
    'function createRelationSuggestionsFromAgentResult(graphIndex, result, relations)',
    'createdSource: \'agent-answer\'',
    'graphSuggestions: suggestions.map(item => publicGraphSuggestion(item, relations, graphIndex)).filter(Boolean)',
    'writeEvent(res, { ...rawEvent, conversationId, result, relations })',
    'insertApprovedSuggestionEdge(suggestion)'
  ]) assert.ok(appSource.includes(fragment), `missing agent relations fragment: ${fragment}`);
});

test('窄屏聊天可从独立资料面板管理范围并进入证据分析', () => {
  for (const fragment of [
    'function SourceScopeSheet',
    'aria-label="筛选资料范围"',
    '加入筛选项',
    '不限篇目',
    'onOpenEvidence?.(draft)',
    'context-scope-manager',
    'aria-label="管理资料范围"',
    'onOpenEvidence={documentIds => openEvidenceWorkbench(documentIds)}'
  ]) assert.ok(mainSource.includes(fragment), `missing mobile scope fragment: ${fragment}`);
});

test('图谱证据工作台保留当前节点传入的资料范围，而不是回退为全局选择', () => {
  for (const fragment of [
    'onOpenEvidenceWorkbench={documentIds => openEvidenceWorkbench(Array.isArray(documentIds) && documentIds.length ? documentIds : selectedDocs)}',
    'onOpenEvidence={documentIds => openEvidenceWorkbench(documentIds)}'
  ]) assert.ok(mainSource.includes(fragment), `missing graph evidence scope fragment: ${fragment}`);
});

test('阅读器证据工作台优先带上当前文档和已选资料', () => {
  assert.match(mainSource, /onOpenEvidenceWorkbench=\{\(\) => openEvidenceWorkbench\(\[readerDetail\.item\.id, \.\.\.selectedDocs\.filter\(id => id !== readerDetail\.item\.id\)\]\)\}/);
  assert.match(readerSource, /onOpenEvidenceWorkbench/);
  assert.match(readerSource, /证据工作台/);
});

test('首页快速提问不带入陈旧上下文，只按知识库范围回答', async () => {
  const unifiedSource = await readFile(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(unifiedSource, /onAsk\?\.\(normalized, \{ currentDocument: null, selection: null, resources: \[\] \}\)/);
  assert.doesNotMatch(unifiedSource, /基于「\$\{libraryName\}」回答/);
  assert.doesNotMatch(unifiedSource, /已带入 \$\{contextCount\} 篇资料/);
});

test('笔记默认在这篇里问，到对话里继续是显式更多项', async () => {
  const notesSource = await readFile(new URL('../src/components/NotesWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(notesSource, /在这篇里问/);
  assert.match(notesSource, /问这篇笔记/);
  assert.match(notesSource, /到对话里继续/);
  assert.match(notesSource, /if \(action === 'ask'\) return/);
  assert.match(notesSource, /fetch\('\/api\/agent\/run'/);
  assert.match(notesSource, /surface: 'note-assistant'/);
  assert.match(notesSource, /question: text/);
  assert.match(mainSource, /function handleWorkspaceAskAboutNote/);
  assert.match(mainSource, /onAskAboutNote={handleWorkspaceAskAboutNote}/);
});

test('空 prompt 只开对话 tab，不触发空 ask', () => {
  assert.match(mainSource, /const text = String\(prompt \|\| ''\)\.trim\(\);\s*if \(text\) void ask\(/);
});

test('Skill 运行次数按钮会打开最近一条记录', () => {
  assert.match(mainSource, /disabled=\{!runs\.length\} onClick=\{\(\) => runs\[0\] && onSelectRun\?\.\(runs\[0\]\)\}/);
});

test('阅读器可在工作区继续跨文档追问，并把当前文档自动加入问答范围', () => {
  for (const fragment of [
    'function handleContinueReaderInWorkspace(item, { selection = null, messages = [] } = {})',
    'onContinueInWorkspace={(item, payload) => handleContinueReaderInWorkspace(item, payload)}',
    'toggleReaderQuestionScope(item, true)'
  ]) assert.ok(mainSource.includes(fragment), `missing reader workspace fusion in main: ${fragment}`);
  for (const fragment of [
    'onContinueInWorkspace',
    '在工作区继续',
    '跨文档追问',
    'content-reader-conversation-composer',
    'openAskComposer'
  ]) assert.ok(readerSource.includes(fragment), `missing reader workspace fusion in ContentReader: ${fragment}`);
});

test('阅读器文档解读沿用当前材料、持久 Skill 历史和后台任务，不跳到独立页面', () => {
  for (const fragment of [
    'async function handleReaderInterpretation(kind, item, selection = null, force = false)',
    "const skillId = kind === 'quiz' ? 'quiz' : 'mind-map'",
    'const existing = !force ? runs.find(run =>',
    "documentIds: [item.id], selection",
    'setSkillRuns(current => [completed, ...current.filter(run => run.id !== completed.id)])',
    'interpretationRuns={runs.filter(run => ["mind-map", "quiz"].includes(run.skillId)'
  ]) assert.ok(mainSource.includes(fragment), `missing Reader interpretation integration: ${fragment}`);
  assert.doesNotMatch(mainSource, /route === ['\"](?:mind-map|quiz)['\"]/);
});