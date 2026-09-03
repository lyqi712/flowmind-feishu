import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitializedApp } from '../server/app.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

const DOC_URL = 'https://xfy60f0qyq.feishu.cn/docx/Bxt7dXGBkoC990xthW2cC9eTnVQ';
const DOC_TITLE = '【6245】关于各种提示词-智能体的问题和模板汇总 为啥你企业用AI不能落地终极解决方案 超10+提示词和IP风格库打造模板【俗人六哥团队原创】';
// 该飞书文档正文为图片块（未登录不可见）；以下是文档公开可读的标题与引言段落，作为真实链接的实测材料。
const DOC_LEAD = `【1】Ai智能体模板框架，基本所有行业通用：
📚 永远记住Ai的本质是：看模板前必看
你要给他你行业足够详细的的信息，比如你的人群信息，你行业的现状，你要的写作风格，你行业的爆款案例等等，没有这些Ai就是一堆垃圾；
下面是一个完整的提示词模板参考，这都是自然语言，你可以在下面的基础上修改；
这并不是固定不变的，这只是六哥近2年的ai研究和16年的互联网综合总结；
它不止是应用到写文案，任何你想让ai帮你解决的问题，都可以这样给ai你行业的信息；
文档结构（依据标题与可见引言推断）：包含 AI 智能体模板框架、超 10+ 提示词模板、IP 风格库；正文其余内容以截图形式存在。`;

test('真实飞书链接作为材料导入后，搜索、关系分析与本地总结 Skill 链路可用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-real-feishu-doc-'));
  const app = await createInitializedApp({
    stateFile: join(root, 'state.json'),
    env: {},
    ocrService: false,
    transcriptionService: false,
    modelService: createFakeModelService(),
    modelOptions: { secretFile: join(root, 'model.enc'), masterKeyFile: join(root, 'model.key') },
    feishuOptions: { secretFile: join(root, 'feishu.enc'), masterKeyFile: join(root, 'feishu.key') },
    workspaceSyncOptions: { secretFile: join(root, 'sync.enc'), masterKeyFile: join(root, 'sync.key'), relayFile: join(root, 'relay.json') }
  });
  const server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function json(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, body: await response.json().catch(() => ({})) };
  }
  try {
    // 1) 导入：内联正文 + 真实来源 URL。
    const imported = await json('/api/content/import', 'POST', {
      items: [{ title: DOC_TITLE, content: DOC_LEAD, sourceType: 'web', sourceUrl: DOC_URL, externalId: 'feishu-doc-Bxt7dXGBkoC990xthW2cC9eTnVQ', tags: ['提示词', '模板', '测试材料'] }]
    });
    assert.equal(imported.response.status, 201);
    assert.equal(imported.body.stats.created, 1);
    const itemId = imported.body.items[0].item.id;

    // 2) 检索：关键词能命中真实标题与引言。
    const search = await json('/api/search?q=提示词&limit=10');
    assert.ok(search.body.total >= 1);
    assert.match(search.body.results[0].title, /提示词/);

    // 3) 内容详情：来源 URL、版本、chunks 与证据就绪。
    const detail = await json(`/api/content/items/${itemId}`);
    assert.equal(detail.body.item.sourceUrl, DOC_URL);
    assert.ok((detail.body.chunks || []).length >= 1, 'chunks must be indexed');
    assert.ok(detail.body.versions?.length >= 1);

    // 4) 本地深度总结 Skill（无模型配置 → 诚实降级路径，不伪造模型输出）。
    const run = await fetch(`${base}/api/skills/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId: 'summary', input: '总结这份提示词模板文档的要点', query: '总结这份提示词模板文档的要点', documentIds: [itemId] })
    });
    const streamText = await run.text();
    const events = streamText.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const done = events.find(event => event.type === 'done');
    assert.ok(done, 'skill run must finish; events=' + events.map(e => e.type).join(','));
    const output = String(done?.result?.artifact?.content || done?.artifact?.content || '');
    assert.ok(output.length > 0, 'summary output must not be empty');
    assert.match(output, /提示词|智能体|模板/, 'summary should reflect the real document topic');
    console.log(JSON.stringify({ ok: true, itemId, importedStats: imported.body.stats, searchTotal: search.body.total, chunks: (detail.body.chunks || []).length, summaryChars: output.length, summaryHead: output.slice(0, 140) }, null, 2));
  } finally {
    await new Promise(resolveServer => server.close(() => resolveServer()));
    await app.locals.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
