import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_SKILL_IDS, chunkDocuments, executeSkill, selectDocuments, SKILL_DOCUMENT_BATCH_LIMIT } from '../server/skills.mjs';
import { createFakeModelService } from './helpers/fake-model.mjs';

test('总结类 Skill 可选超过 6 份文档', () => {
  const documents = Array.from({ length: 10 }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `文档 ${index + 1}`,
    content: `这是第 ${index + 1} 份资料的正文。`
  }));
  const selected = selectDocuments(documents, {
    documentIds: documents.map(item => item.id),
    limit: SKILL_DOCUMENT_BATCH_LIMIT
  });
  assert.equal(selected.length, 10);
  assert.equal(chunkDocuments(selected, 6).length, 2);
  assert.ok(BATCH_SKILL_IDS.has('summary'));
});

test('超过 6 份时先分批整理再综合', async () => {
  const documents = Array.from({ length: 8 }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `材料 ${index + 1}`,
    content: `材料 ${index + 1} 的结论是可以分批处理。`
  }));
  const modelService = createFakeModelService({ skillContent: '本批结论：可继续综合 [1]。' });
  const events = [];
  for await (const event of executeSkill('summary', documents, { documentIds: documents.map(item => item.id) }, { modelService })) {
    events.push(event);
  }
  assert.ok(modelService.seen.length >= 3, '应先跑两批再综合');
  assert.ok(events.some(event => event.detail?.includes('将分 2 批整理')));
  assert.ok(events.some(event => event.step === 'batch-1' && event.status === 'completed'));
  assert.ok(events.some(event => event.step === 'synthesize'));
  assert.ok(events.some(event => event.type === 'complete' || event.artifact || event.type === 'done' || event.type === 'result'));
});
