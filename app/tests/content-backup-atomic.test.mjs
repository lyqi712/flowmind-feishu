import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentBackupService, ContentRepository } from '../server/content/index.mjs';

test('a late restore failure rolls back every prior item instead of leaving a partial library', () => {
  const source = new ContentRepository({ databasePath: ':memory:' });
  const target = new ContentRepository({ databasePath: ':memory:' });
  try {
    const first = source.createNote({ title: '恢复项一', content: '第一条内容' }).item;
    source.createNote({ title: '恢复项二', content: '第二条内容' });
    source.upsertAttachment({ contentItemId: first.id, externalId: 'restore-failure', fileName: 'file.txt', mimeType: 'text/plain', data: Buffer.from('fixture') });
    const keep = target.createNote({ title: '用户已有笔记', content: '必须保留' }).item;
    const archive = new ContentBackupService({ repository: source }).createArchive();
    target.upsertAttachment = () => { throw new Error('synthetic attachment write failure'); };
    assert.throws(() => new ContentBackupService({ repository: target }).restoreArchive(archive), /synthetic attachment write failure/);
    assert.deepEqual(target.listContentItems().map(item => item.id), [keep.id]);
    assert.equal(target.getContentItem(keep.id).content, '必须保留');
  } finally { source.close(); target.close(); }
});
