import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(here, '../src/main.jsx'), 'utf8');
const workspaceSource = readFileSync(resolve(here, '../src/components/UnifiedWorkspace.jsx'), 'utf8');
const notesSource = readFileSync(resolve(here, '../src/components/NotesWorkspace.jsx'), 'utf8');
const displayTextSource = readFileSync(resolve(here, '../src/workspace/display-text.js'), 'utf8');

test('opening a search result yields the workspace and keeps a return path to the same result list', () => {
  const searchBlock = mainSource.slice(mainSource.indexOf('async function openWorkspaceSearchResult'), mainSource.indexOf('async function handleWorkspaceCreateNote'));
  assert.match(searchBlock, /closeWorkspaceSearch\(\)/, 'opening a result must yield the workspace immediately');
  assert.match(mainSource, /function reopenWorkspaceSearch\(\)/);
  assert.match(mainSource, /function rememberSearchOrigin/);
  assert.match(searchBlock, /rememberSearchOrigin\(`document-\$\{result\.id\}`\)/);
  assert.match(searchBlock, /rememberSearchOrigin\(`note-\$\{result\.id\}`\)/);
  assert.match(searchBlock, /rememberSearchOrigin\(tab\.id\)/);
  assert.match(workspaceSource, /function shouldShowReturnSearch/);
  assert.match(workspaceSource, /shouldShowReturnSearch\(search, activeTab\?\.id\)/);
  for (const fragment of [
    'setOpenedId(String(result.id))',
    'data-search-opened',
    '已打开',
    'is-opened',
    'onClose?.({ restoreFocus: false })',
    'aria-label="返回搜索结果"',
    'onReopenSearch'
  ]) assert.ok(workspaceSource.includes(fragment) || (fragment === 'onReopenSearch' && mainSource.includes(fragment)), `missing non-blocking search continuity contract: ${fragment}`);
});

test('工作区搜索面板接到真实结果，首页提问不锁上次打开的文档', () => {
  assert.match(mainSource, /search=\{workspaceSearch\}/);
  assert.match(mainSource, /onCloseSearch=\{closeWorkspaceSearch\}/);
  assert.match(mainSource, /onOpenSearchResult=\{openWorkspaceSearchResult\}/);
  assert.match(mainSource, /onReopenSearch=\{reopenWorkspaceSearch\}/);
  assert.match(mainSource, /onOpenSearch=\{openWorkspaceSearchPanel\}/);
  const askBlock = mainSource.slice(mainSource.indexOf('function handleWorkspaceAsk'), mainSource.indexOf('function readerWorkspaceContext'));
  assert.match(askBlock, /const onHome = !activeWorkspaceTab/);
  assert.match(askBlock, /explicitDocumentId/);
  assert.match(askBlock, /onHome && !explicitDocumentId/);
  assert.match(askBlock, /currentDocument: null, selection: null, resources: \[\]/);
  assert.match(workspaceSource, /function scopedContextCount/);
  assert.match(workspaceSource, /item\?\.kind === 'knowledge-base'/);
});

test('回首页清掉阅读器选区，打开同一会话只复用一个标签', () => {
  assert.match(mainSource, /function clearHomeAskResidue/);
  assert.match(mainSource, /leftoverDocument \|\| item\?\.kind === 'selection'/);
  const activateBlock = mainSource.slice(mainSource.indexOf('function activateWorkspaceTab'), mainSource.indexOf('function closeWorkspaceTab'));
  assert.match(activateBlock, /clearHomeAskResidue\(\)/);
  const homeModuleBlock = mainSource.slice(mainSource.indexOf("if (id === 'home')"), mainSource.indexOf("if (id === 'knowledge')"));
  assert.match(homeModuleBlock, /clearHomeAskResidue\(\)/);
  const lastTabHomeBlock = mainSource.slice(mainSource.indexOf('const tab = workspaceSession.tabs.find(item => item.id === workspaceSession.activeTabId) || null;'), mainSource.indexOf('const route = tab.route || (tab.kind === \'document\' || tab.kind === \'chat\' ? \'knowledge\' : tab.kind);'));
  assert.match(lastTabHomeBlock, /clearHomeAskResidue\(\)/);
  assert.match(mainSource, /findChatTabByConversationId\(workspaceSession\.tabs, scene\?\.conversationId\)/);
  const searchBlock = mainSource.slice(mainSource.indexOf('async function openWorkspaceSearchResult'), mainSource.indexOf('async function handleWorkspaceCreateNote'));
  assert.match(searchBlock, /scene: \{ conversationId: data\.conversation\?\.id \|\| result\.conversationId \|\| result\.id \}/);
  assert.match(workspaceSource, /scopedContextCount\(snapshot\)/);
  assert.match(workspaceSource, /snapshot\.resources\.filter\(item => !isLibraryPlaceholder\(item\)\)/);
});

test('搜索结果摘要剥 Markdown，并按文档/笔记/会话筛选', () => {
  assert.match(workspaceSource, /searchExcerptPreview\(result\.excerpt/);
  assert.match(workspaceSource, /searchResultTitle\(result\.title/);
  assert.match(workspaceSource, /SEARCH_TYPE_FILTERS/);
  assert.match(workspaceSource, /按类型筛选/);
  assert.match(workspaceSource, /setTypeFilter/);
  assert.match(displayTextSource, /result\?\.type \|\| result\?\.kind \|\| result\?\.itemType/);
  const searchBlock = mainSource.slice(mainSource.indexOf('async function openWorkspaceSearchResult'), mainSource.indexOf('async function handleWorkspaceCreateNote'));
  assert.match(searchBlock, /const type = searchResultType\(result\)/);
  assert.match(searchBlock, /if \(type === 'document'\)/);
  assert.match(searchBlock, /if \(type === 'note'\)/);
  assert.match(searchBlock, /if \(type === 'conversation'\)/);
  assert.doesNotMatch(searchBlock, /if \(result\.type === 'document'\)/);
  assert.doesNotMatch(workspaceSource, /<small>\{result\.excerpt \|\| '没有可预览的内容'\}<\/small>/);
});

test('笔记有内容时打开最近一篇，空列表才显示欢迎页', () => {
  const loadBlock = notesSource.slice(notesSource.indexOf('async function load(nextArchived = archived)'), notesSource.indexOf('useEffect(() => { load(archived); }, [archived]);'));
  assert.match(loadBlock, /pickOpenNote\(list, \{ preferredId: initialNoteId, selectedId \}\)/);
  assert.match(notesSource, /<ModuleWelcome icon=\{NotebookPen\} title="构建你的个人知识层"/);
  assert.match(notesSource, /action=\{createNote\} actionLabel="创建第一篇笔记"/);
});

test('after a sync the app selects the library that actually contains documents', () => {
  const syncBlock = mainSource.slice(mainSource.indexOf('{showSync &&'), mainSource.indexOf('{modelDrawerOpen &&'));
  for (const fragment of [
    'resolveLibraryAfterSync',
    'refreshContentItems().catch(error => notify',
    'refreshContentItems().catch(error => notify(errText(error, \'同步完成但内容列表刷新失败\'), \'error\') || []).then(items =>',
    'setSelectedKb(resolveLibraryAfterSync(next, items))'
  ]) assert.ok(syncBlock.includes(fragment), `missing post-sync library selection: ${fragment}`);
  assert.doesNotMatch(syncBlock, /setSelectedKb\(next\.settings\?\?activeKnowledgeBaseId \|\| next\.knowledgeBases\?\?\[0\]/, 'must not blindly keep an empty default library');
});

test('startup and empty-library views prefer a library that still has documents', () => {
  assert.match(mainSource, /function resolveDefaultLibrary/);
  assert.match(mainSource, /setSelectedKb\(resolveDefaultLibrary\(libraries, \{ preferredId: requestedKb, documents: normalizedDocuments \}\)/);
  assert.match(mainSource, /这个空间还没有文档/);
  assert.match(mainSource, /empty-side-switch/);
  assert.doesNotMatch(mainSource, /setSelectedKb\(\(requestedKb && libraries\.some\(item => item\.id === requestedKb\)\) \? requestedKb : libraries\[0\]\?\.id \|\| 'local-content'\)/);
});
