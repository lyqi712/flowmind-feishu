import assert from 'node:assert/strict';
import test from 'node:test';
import { McpConnectorGateway, normalizeMcpConnectors } from '../server/mcp-gateway.mjs';
import { groundedAskKnowledge } from '../mcp/server.mjs';
import { EMPTY_RETRIEVAL_ANSWER } from '../server/retrieval-policy.mjs';

test('MCP connectors keep command metadata and never invent env secrets', () => {
  const connectors = normalizeMcpConnectors([
    { name: 'files', command: 'npx', args: '-y filesystem D:\\notes', enabled: true },
    { name: '', command: 'npx' },
    { id: 'dup', name: 'a', command: 'node' },
    { id: 'dup', name: 'b', command: 'node' }
  ]);
  assert.equal(connectors.length, 2);
  assert.deepEqual(connectors[0].args, ['-y', 'filesystem', 'D:\\notes']);
  assert.equal(connectors.some(item => 'env' in item), false);
});

test('MCP gateway lists and reads through configured connectors', async () => {
  const gateway = new McpConnectorGateway({
    getConnectors: () => [{ id: 'files', name: 'files', command: 'npx', args: [], enabled: true }],
    createClient: async () => ({
      client: {
        listTools: async () => ({ tools: [{ name: 'read_file', description: 'Read a file' }] }),
        listResources: async () => ({ resources: [{ uri: 'file://notes.md', name: 'notes' }] }),
        readResource: async ({ uri }) => ({ contents: [{ uri, text: 'hello from mcp' }] })
      }
    })
  });
  const listed = await gateway.list();
  assert.equal(listed.tools[0].qualifiedName, 'files/read_file');
  const read = await gateway.read('file://notes.md');
  assert.match(read.contents[0].text, /hello from mcp/);
});

test('MCP knowledge ask refuses to fabricate when the library has no evidence', () => {
  const empty = groundedAskKnowledge([{ id: 'menu', title: '食堂菜单', content: '周一西红柿炒鸡蛋。' }], 'ZXCVBNMQUUX99xyzzy');
  assert.equal(empty.citationStatus, 'empty_retrieval');
  assert.equal(empty.answer, EMPTY_RETRIEVAL_ANSWER);
  assert.equal(empty.citations.length, 0);
  const hit = groundedAskKnowledge([{ id: 'plan', title: '发布计划', content: '上线前必须完成安全审批，负责人是 Alice。' }], '发布前谁负责审批');
  assert.equal(hit.citationStatus, 'local-evidence');
  assert.match(hit.answer, /Alice|审批/);
  assert.ok(hit.citations.length >= 1);
});
