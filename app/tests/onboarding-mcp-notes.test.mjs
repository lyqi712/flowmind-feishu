import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { buildMcpConnectKit } from '../server/mcp-connect.mjs';
import { extractNoteAttachmentText, noteSearchableContent, webClipMarkdown } from '../server/note-knowledge.mjs';
import { EMPTY_RETRIEVAL_ANSWER } from '../server/retrieval-policy.mjs';
import { AgentRuntime } from '../server/agent/runtime.mjs';
import { ToolRegistry } from '../server/agent/tool-registry.mjs';
import { JsonStateStore } from '../server/state-store.mjs';
import { isMcpStdioArgv } from '../desktop/mcp-stdio.mjs';

const wizard = readFileSync(new URL('../src/components/FeishuSyncWizard.jsx', import.meta.url), 'utf8');
const feishuSetup = readFileSync(new URL('../src/workspace/feishu-setup.js', import.meta.url), 'utf8');
const collection = readFileSync(new URL('../src/components/CollectionCenter.jsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/SettingsExperience.jsx', import.meta.url), 'utf8');
const notes = readFileSync(new URL('../src/components/NotesWorkspace.jsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/components/UnifiedWorkspace.jsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8');
const desktopMain = readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8');

test('MCP connect kit is a copy-paste prompt other AIs can follow without guessing paths', () => {
  const kit = buildMcpConnectKit({
    serverPath: 'D:\\\\flowmind\\\\mcp\\\\server.mjs',
    apiBaseUrl: 'http://127.0.0.1:8789',
    stateFile: 'D:\\\\data\\\\state.json'
  });
  assert.match(kit.prompt, /search_knowledge/);
  assert.match(kit.prompt, /ask_knowledge/);
  assert.match(kit.prompt, /不要编造/);
  assert.equal(kit.claudeDesktop.mcpServers.flowmind.args[0], 'D:\\\\flowmind\\\\mcp\\\\server.mjs');
  assert.match(kit.codex, /FLOWMIND_API_URL/);
  assert.match(settings, /复制给其他 AI 的提示词/);
  assert.match(settings, /data-mcp-connect-kit/);
  assert.match(settings, /data-settings-panel=\{SECTION_KNOWLEDGE\}/);
  assert.match(settings, /<McpConnectorSettings fetcher=\{fetcher\} onToast=\{onToast\} \/>/);
});

test('飞书向导和收集入口给出第一次就能跟着做的步骤', () => {
  assert.match(wizard, /data-feishu-permission-guide/);
  assert.match(feishuSetup, /docx:document:readonly/);
  assert.match(feishuSetup, /drive:drive:readonly/);
  assert.match(feishuSetup, /添加文档应用/);
  assert.match(collection, /data-onboarding="import"/);
  assert.match(collection, /打开飞书导入/);
  assert.match(home, /data-onboarding="home"/);
  assert.match(home, /开始收集/);
  assert.match(main, /data-onboarding="knowledge"/);
  assert.match(main, /导入文件/);
  assert.match(main, /连接飞书/);
  assert.doesNotMatch(main, /function SyncModal/);
  assert.match(builder, /node_modules\/tesseract\.js-core\/\*\*\/\*/);
  assert.match(builder, /node_modules\/@tesseract\.js-data\/\*\*\/\*/);
  assert.match(builder, /installerLanguages:/);
  assert.match(builder, /zh_CN/);
  assert.match(builder, /createDesktopShortcut:\s*true/);
  assert.match(builder, /runAfterFinish:\s*true/);
});

test('安装包里的 MCP 入口是 FlowMind --mcp，且不和主窗口抢单实例锁', () => {
  assert.equal(isMcpStdioArgv(['FlowMind.exe', '--mcp']), true);
  assert.equal(isMcpStdioArgv(['FlowMind.exe']), false);
  assert.match(desktopMain, /startMcpStdio/);
  assert.match(desktopMain, /mcpMode \|\| app.requestSingleInstanceLock/);
  assert.match(desktopMain, /if \(mcpMode\) return;/);
});

test('笔记可插入网页，对话 @ 分组单独列出笔记', () => {
  assert.match(notes, /insertNoteWebClip/);
  assert.match(notes, />网页</);
  assert.match(notes, /在对话里问这篇/);
  assert.match(main, /kind: 'notes'/);
  assert.match(main, /笔记（@ 之后会读全文、附件和网页）/);
});

test('text attachments become searchable note evidence', () => {
  const extracted = extractNoteAttachmentText('会议.txt', 'text/plain', Buffer.from('发布闸门由 Alice 点头放行', 'utf8'));
  assert.match(extracted, /Alice/);
  const note = { content: '备忘', attachments: [{ fileName: '会议.txt', extractedText: extracted }] };
  assert.match(noteSearchableContent(note), /Alice/);
  assert.match(webClipMarkdown({ title: '规范', url: 'https://example.com/a', excerpt: '先过审批' }), /example.com/);
});

test('note file text is in Agent evidence when the note is in scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-note-cite-'));
  const store = new JsonStateStore(join(root, 'state.json'));
  await store.ready;
  const documents = [{
    id: 'note-1',
    title: '发布备忘',
    content: noteSearchableContent({
      content: '见附件。',
      attachments: [{ fileName: '闸门.txt', extractedText: '上线前必须完成安全审批，负责人是 Alice。' }]
    }),
    type: 'note',
    contentType: 'note',
    source: 'local-note'
  }];
  class FixtureModel {
    constructor() { this.messages = []; }
    async publicSettings() { return { provider: 'openai-chat', model: 'fixture', configured: true }; }
    async *streamGenerate({ messages = [] }) {
      this.messages.push(structuredClone(messages));
      yield '附件写明 Alice 负责审批 [1]。';
    }
  }
  const model = new FixtureModel();
  const runtime = new AgentRuntime({
    modelService: model,
    registry: new ToolRegistry({ getDocuments: () => documents }),
    store,
    firstTokenTimeoutMs: 40
  });
  const events = [];
  for await (const event of runtime.run({
    question: '发布前谁负责审批？',
    mode: 'auto',
    context: { scopeRequested: true, documentIds: ['note-1'], selectedDocuments: documents }
  })) events.push(event);
  const done = events.find(event => event.type === 'done');
  assert.match(String(model.messages[0]?.[1]?.content || ''), /Alice/);
  assert.notEqual(done.result.answer, EMPTY_RETRIEVAL_ANSWER);
  assert.match(done.result.answer, /Alice/);
  await rm(root, { recursive: true, force: true });
});

test('note web-clip and MCP connect-kit HTTP are available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-onboard-api-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') }
  });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const kit = await (await fetch(`${base}/api/settings/mcp`)).json();
    assert.match(kit.connectKit.prompt, /ask_knowledge/);
    const created = await (await fetch(`${base}/api/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '带文件的笔记', content: '正文' })
    })).json();
    const file = await fetch(`${base}/api/notes/${created.note.id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('闸门.txt') },
      body: Buffer.from('上线前必须完成安全审批，负责人是 Alice。')
    });
    const uploaded = await file.json();
    assert.equal(file.status, 201);
    assert.match(uploaded.attachment.extractedText, /Alice/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await rm(root, { recursive: true, force: true });
  }
});
