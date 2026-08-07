import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDefaultState } from '../server/state-store.mjs';
import { ContentRepository } from '../server/content/index.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'flowmind-mcp-smoke-'));
const stateFile = join(root, 'state.json');
const contentDatabase = join(root, 'content.sqlite');
const evidenceFile = process.env.FLOWMIND_MCP_EVIDENCE || join(projectRoot, 'evidence', 'mcp-smoke.json');
const state = createDefaultState();
state.mode = 'mock';
state.documents = [
  { id: 'doc-mcp-1', title: '飞书项目计划', type: 'docx', knowledgeBaseId: 'feishu-space', content: '项目目标是完成飞书知识同步、引用问答和 MCP 集成。负责人需要验证桌面端和移动端。', url: 'https://example.feishu.cn/docx/doc-mcp-1', updatedAt: new Date().toISOString() },
  { id: 'doc-mcp-2', title: '产品验收清单', type: 'sheet', knowledgeBaseId: 'feishu-space', content: '验收要求包括同步统计、错误重试、知识检索、Skill 工作流和文档资源读取。', url: 'https://example.feishu.cn/sheets/doc-mcp-2', updatedAt: new Date().toISOString() }
];
state.knowledgeBases[0].documentCount = state.documents.length;
await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

const content = new ContentRepository({ databasePath: contentDatabase });
const localSource = content.upsertSourceConnection({ sourceType: 'local', externalId: 'mcp-smoke-local', name: 'MCP Smoke Local' });
const localSpace = content.upsertSpace({ sourceConnectionId: localSource.id, externalId: 'local-imports', name: '本地导入' });
const sqliteOnly = content.upsertContentItem({
  sourceConnectionId: localSource.id,
  spaceId: localSpace.id,
  externalId: 'sqlite-only.md',
  contentType: 'markdown',
  mimeType: 'text/markdown',
  title: 'SQLite 独有上传文档',
  content: '这份内容只写入统一 SQLite 内容库，用于验证 MCP 能读取上传文档并参与检索、问答、Skill 和资源访问。',
  metadata: { upload: true, localPath: 'D:\\private\\must-not-leak.md' }
});
content.replaceIndexChunks(sqliteOnly.item.id, [{ text: sqliteOnly.item.content, metadata: { section: '全文' } }], { contentVersionId: sqliteOnly.item.currentVersionId });
content.close();

const client = new Client({ name: 'flowmind-mcp-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(appRoot, 'mcp', 'server.mjs')],
  cwd: appRoot,
  env: { ...process.env, FLOWMIND_STATE_FILE: stateFile, FLOWMIND_CONTENT_DATABASE: contentDatabase, FLOWMIND_API_URL: 'http://127.0.0.1:1' },
  stderr: 'pipe'
});
let stderr = '';
transport.stderr?.on('data', chunk => { stderr += String(chunk); });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const resources = await client.listResources();
  const search = await client.callTool({ name: 'search_knowledge', arguments: { query: 'MCP 集成', limit: 3 } });
  const sqliteSearch = await client.callTool({ name: 'search_knowledge', arguments: { query: 'SQLite 独有', limit: 3 } });
  const ask = await client.callTool({ name: 'ask_knowledge', arguments: { question: '项目需要完成什么？', limit: 3 } });
  const sqliteAsk = await client.callTool({ name: 'ask_knowledge', arguments: { question: '哪份内容只写入统一内容库？', documentIds: [sqliteOnly.item.id], limit: 3 } });
  const skill = await client.callTool({ name: 'run_skill', arguments: { skillId: 'summary', query: 'SQLite 内容库', documentIds: [sqliteOnly.item.id], limit: 2 } });
  const document = await client.readResource({ uri: 'flowmind://documents/doc-mcp-1' });
  const sqliteDocument = await client.readResource({ uri: `flowmind://documents/${encodeURIComponent(sqliteOnly.item.id)}` });
  const status = await client.readResource({ uri: 'flowmind://status' });
  const result = {
    ok: true,
    protocol: 'stdio',
    initialized: true,
    toolCount: tools.tools.length,
    tools: tools.tools.map(tool => tool.name),
    resourceCount: resources.resources.length,
    resources: resources.resources.map(resource => resource.uri),
    calls: {
      search: search.content?.[0]?.text?.includes('doc-mcp-1') === true,
      sqliteSearch: sqliteSearch.content?.[0]?.text?.includes(sqliteOnly.item.id) === true,
      ask: ask.content?.[0]?.text?.includes('citations') === true,
      sqliteAsk: sqliteAsk.content?.[0]?.text?.includes(sqliteOnly.item.id) === true,
      skill: skill.content?.[0]?.text?.includes(sqliteOnly.item.id) === true,
      readDocument: document.contents?.[0]?.text?.includes('飞书项目计划') === true,
      readSqliteDocument: sqliteDocument.contents?.[0]?.text?.includes('只写入统一 SQLite 内容库') === true,
      metadataSanitized: sqliteDocument.contents?.[0]?.text?.includes('must-not-leak') === false,
      readStatus: status.contents?.[0]?.text?.includes('"documents": 3') === true && status.contents?.[0]?.text?.includes('"source": "sqlite"') === true
    },
    stderr: stderr.trim()
  };
  result.ok = result.ok && Object.values(result.calls).every(Boolean) && result.tools.includes('feishu_sync') && result.tools.includes('run_skill');
  await mkdir(dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
