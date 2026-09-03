import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { EMPTY_RETRIEVAL_ANSWER } from '../server/retrieval-policy.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { buildAnswerFeedbackPayload } from '../src/workspace/answer-feedback.js';
import { isProblemNote, problemNoteDraft } from '../src/workspace/note-capture.js';
import { normalizeClientBrowseUrl } from '../src/workspace/web-browse.js';
import { isMcpStdioArgv } from '../desktop/mcp-stdio.mjs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const collection = readFileSync(new URL('../src/components/CollectionCenter.jsx', import.meta.url), 'utf8');
const wizard = readFileSync(new URL('../src/components/FeishuSyncWizard.jsx', import.meta.url), 'utf8');
const notes = readFileSync(new URL('../src/components/NotesWorkspace.jsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/SettingsExperience.jsx', import.meta.url), 'utf8');
const browser = readFileSync(new URL('../src/components/EmbeddedBrowser.jsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8');

class ScriptedModel {
  constructor(replies) {
    this.replies = replies;
    this.calls = [];
  }
  async publicSettings() {
    return { provider: 'openai-chat', model: 'fixture', configured: true };
  }
  async *streamGenerate({ messages = [] }) {
    this.calls.push(structuredClone(messages));
    const blob = JSON.stringify(messages);
    for (const [pattern, reply] of this.replies) {
      if (pattern.test(blob)) {
        yield reply;
        return;
      }
    }
    yield EMPTY_RETRIEVAL_ANSWER;
  }
}

async function runAgent(runtime, input) {
  const events = [];
  for await (const event of runtime.run(input)) events.push(event);
  return events.find(event => event.type === 'done')?.result || null;
}

test('新人小陈：空库先收集，不弹废弃同步窗，问答前能去配模型', () => {
  assert.match(home, /data-onboarding="home"/);
  assert.match(home, /开始收集/);
  assert.match(collection, /data-onboarding="import"/);
  assert.match(collection, /打开飞书导入/);
  assert.match(collection, /选择文件/);
  assert.match(main, /data-onboarding="knowledge"/);
  assert.match(main, /配置模型/);
  assert.doesNotMatch(main, /function SyncModal/);
  assert.doesNotMatch(desktop, /luxiaofei/);
});

test('飞书运营小周：向导给出只读权限步骤，同步后能打开知识库', () => {
  assert.match(wizard, /data-feishu-permission-guide/);
  assert.match(wizard, /连接飞书/);
  assert.match(wizard, /开始同步/);
  assert.match(main, /FeishuSyncWizard/);
  assert.match(main, /resolveLibraryAfterSync/);
  assert.match(main, /打开飞书连接向导|onOpenFeishuWizard/);
  assert.match(settings, /打开飞书连接向导/);
});

test('踩坑记录阿宁：问题记录三块可写，网页只能剪公网并写入问题记录', () => {
  const draft = problemNoteDraft({ question: '出锅忘葱花', pitfall: '出锅前再看一眼葱花' });
  assert.equal(isProblemNote(draft), true);
  assert.match(notes, /下次容易忘的点/);
  assert.match(notes, /createNote\('problem'\)/);
  assert.match(browser, /剪进问题记录/);
  assert.match(browser, /粘贴网址，看完再剪藏/);
  assert.throws(() => normalizeClientBrowseUrl('http://127.0.0.1/secret'), /内网/);
  assert.throws(() => normalizeClientBrowseUrl('http://localhost/'), /内网/);
  assert.equal(normalizeClientBrowseUrl('example.com').hostname, 'example.com');
  assert.match(main, /handleClipWebToProblemNote/);
});

test('研发阿凯：MCP 在知识库设置里，桌面 --mcp 不抢主窗口', () => {
  assert.equal(isMcpStdioArgv(['FlowMind.exe', '--mcp']), true);
  assert.match(desktop, /startMcpStdio/);
  assert.match(desktop, /mcpMode \|\| app.requestSingleInstanceLock/);
  assert.match(settings, /data-settings-panel=\{SECTION_KNOWLEDGE\}/);
  assert.match(settings, /data-mcp-connect-kit/);
  assert.match(settings, /复制给其他 AI 的提示词/);
});

test('分析师小林：解读写作录音从对话更多进入，斜杠不堆功能清单', () => {
  assert.match(main, /id: 'action-add-file'/);
  assert.match(main, /id: 'action-problem-note'/);
  assert.doesNotMatch(main, /id: 'action-recording'/);
  assert.doesNotMatch(main, /id: 'action-writing'/);
  assert.match(main, />Skill 工作台</);
  assert.match(main, />文档解读</);
  assert.match(main, />录音纪要</);
  assert.match(main, />写作草稿</);
  assert.match(main, /onOpenModule\?\.\('analysis'\)/);
  assert.match(main, /onOpenModule\?\.\('recording'\)/);
  assert.match(main, /onOpenModule\?\.\('skills'\)/);
});

test('空库人物问事实题时拒答，不拿常识顶替', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-persona-empty-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const runtime = new AgentRuntime({
    modelService: new ScriptedModel([[/.*/, 'Alice 负责发布，这是常识。']]),
    registry: new ToolRegistry({ getDocuments: () => [] }),
    store,
    firstTokenTimeoutMs: 40
  });
  const result = await runAgent(runtime, { question: '发布闸门谁点头？', mode: 'auto' });
  assert.equal(result.answer, EMPTY_RETRIEVAL_ANSWER);
  await rm(root, { recursive: true, force: true });
});

test('两组同事同时问各自资料，答案互不串组', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-persona-teams-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const documents = [
    { id: 'doc-alice', title: 'A 组值班', content: 'A 组发布闸门由 Alice 点头。' },
    { id: 'doc-bob', title: 'B 组值班', content: 'B 组发布闸门由 Bob 点头。' }
  ];
  const model = new ScriptedModel([
    [/Alice 点头/, 'A 组是 Alice [1]。'],
    [/Bob 点头/, 'B 组是 Bob [1]。']
  ]);
  const runtime = new AgentRuntime({
    modelService: model,
    registry: new ToolRegistry({ getDocuments: () => documents }),
    store,
    firstTokenTimeoutMs: 40
  });
  const [alice, bob] = await Promise.all([
    runAgent(runtime, {
      question: '我们组发布谁点头？',
      mode: 'auto',
      context: { scopeRequested: true, documentIds: ['doc-alice'], selectedDocuments: [documents[0]] }
    }),
    runAgent(runtime, {
      question: '我们组发布谁点头？',
      mode: 'auto',
      context: { scopeRequested: true, documentIds: ['doc-bob'], selectedDocuments: [documents[1]] }
    })
  ]);
  assert.match(alice.answer, /Alice/);
  assert.doesNotMatch(alice.answer, /Bob/);
  assert.match(bob.answer, /Bob/);
  assert.doesNotMatch(bob.answer, /Alice/);
  await rm(root, { recursive: true, force: true });
});

test('读者点赞和点踩都要带会话与回答 id，踩还要问题类型', () => {
  assert.equal(buildAnswerFeedbackPayload({ conversationId: 'c1', messageId: 'm1', rating: 'positive' }).valid, true);
  assert.equal(buildAnswerFeedbackPayload({ conversationId: '', messageId: 'm1', rating: 'positive' }).valid, false);
  const negative = buildAnswerFeedbackPayload({
    conversationId: 'c1', messageId: 'm1', rating: 'negative', issueType: 'fabricated'
  });
  assert.equal(negative.valid, true);
  assert.equal(negative.issueType, 'fabricated');
  assert.match(main, /<MessageFeedback conversationId=\{message.conversationId \|\| conversationId\}/);
});
