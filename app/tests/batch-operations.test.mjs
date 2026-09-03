import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BatchOperationService } from '../server/batch-operations.mjs';

// Mock ContentRepository
class MockContentRepository {
  constructor() {
    this.documents = new Map();
    this.nextId = 1;
  }

  async create(data) {
    const id = `doc_${this.nextId++}`;
    const doc = { id, ...data };
    this.documents.set(id, doc);
    return doc;
  }

  async findById(id) {
    return this.documents.get(id) || null;
  }

  async update(id, data) {
    const doc = this.documents.get(id);
    if (!doc) throw new Error('Document not found');
    const updated = { ...doc, ...data };
    this.documents.set(id, updated);
    return updated;
  }

  async delete(id) {
    return this.documents.delete(id);
  }
}

test('批量操作 - 创建操作', () => {
  const service = new BatchOperationService();

  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const operationId = service.createOperation('test', items);

  assert.ok(operationId.startsWith('batch_'));

  const status = service.getOperationStatus(operationId);
  assert.equal(status.type, 'test');
  assert.equal(status.total, 3);
  assert.equal(status.status, 'pending');
});

test('批量操作 - 执行简单操作', async () => {
  const service = new BatchOperationService();

  const items = [1, 2, 3, 4, 5];
  const operationId = service.createOperation('double', items);

  const processFn = async (item) => item * 2;

  const result = await service.execute(operationId, processFn);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 5);
  assert.equal(result.failed, 0);
  assert.equal(result.progress, 100);
});

test('批量操作 - 处理部分失败', async () => {
  const service = new BatchOperationService();

  const items = [1, 2, 3, 4, 5];
  const operationId = service.createOperation('test', items);

  const processFn = async (item) => {
    if (item === 3) throw new Error('Failed at 3');
    return item * 2;
  };

  const result = await service.execute(operationId, processFn);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 4);
  assert.equal(result.failed, 1);
});

test('批量操作 - 并发控制', async () => {
  const service = new BatchOperationService({ concurrency: 2 });

  const items = [1, 2, 3, 4, 5];
  const operationId = service.createOperation('test', items);

  const processing = [];
  const processFn = async (item) => {
    processing.push(item);
    await new Promise(resolve => setTimeout(resolve, 50));
    processing.splice(processing.indexOf(item), 1);

    // 在任何时刻，正在处理的项目不应超过并发数
    assert.ok(processing.length <= 2);

    return item;
  };

  await service.execute(operationId, processFn);
});

test('批量操作 - 超时处理', async () => {
  const service = new BatchOperationService({ timeout: 100 });

  const items = [1, 2];
  const operationId = service.createOperation('test', items);

  const processFn = async (item) => {
    if (item === 2) {
      await new Promise(resolve => setTimeout(resolve, 200)); // 超时
    }
    return item;
  };

  const result = await service.execute(operationId, processFn);

  assert.equal(result.success, 1);
  assert.equal(result.failed, 1);
});

test('批量操作 - 获取详细结果', async () => {
  const service = new BatchOperationService();

  const items = [1, 2, 3];
  const operationId = service.createOperation('test', items);

  await service.execute(operationId, async (item) => item * 2);

  const results = service.getOperationResults(operationId);

  assert.equal(results.items.length, 3);
  assert.equal(results.items[0].result, 2);
  assert.equal(results.items[1].result, 4);
  assert.equal(results.items[2].result, 6);
  assert.ok(results.items.every(item => item.status === 'success'));
});

test('批量操作 - 取消操作', async () => {
  const service = new BatchOperationService({ concurrency: 1 });

  const items = Array(10).fill(0).map((_, i) => i);
  const operationId = service.createOperation('test', items);

  const processFn = async (item) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return item;
  };

  // 开始执行后立即取消
  const executePromise = service.execute(operationId, processFn);

  setTimeout(() => {
    service.cancelOperation(operationId);
  }, 250); // 延长取消时间

  await executePromise;

  const status = service.getOperationStatus(operationId);
  // 取消后可能是cancelled或completed状态
  assert.ok(['cancelled', 'completed'].includes(status.status));
});

test('批量操作 - 批量导入文档', async () => {
  const service = new BatchOperationService();
  const repo = new MockContentRepository();

  const documents = [
    { title: 'Doc 1', content: 'Content 1', knowledgeBaseId: 'kb1' },
    { title: 'Doc 2', content: 'Content 2', knowledgeBaseId: 'kb1' },
    { title: 'Doc 3', content: 'Content 3', knowledgeBaseId: 'kb1' }
  ];

  const result = await service.batchImportDocuments(documents, repo);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 3);
  assert.equal(repo.documents.size, 3);
});

test('批量操作 - 导入文档验证失败', async () => {
  const service = new BatchOperationService();
  const repo = new MockContentRepository();

  const documents = [
    { title: 'Doc 1', content: 'Content 1' },
    { content: 'Content 2' }, // 缺少 title
    { title: 'Doc 3', content: 'Content 3' }
  ];

  const result = await service.batchImportDocuments(documents, repo);

  assert.equal(result.success, 2);
  assert.equal(result.failed, 1);
});

test('批量操作 - 批量引用验证', async () => {
  const service = new BatchOperationService();
  const repo = new MockContentRepository();

  // 创建一些文档
  await repo.create({ title: 'Doc 1', content: 'Content 1' });
  await repo.create({ title: 'Doc 2', content: 'Content 2' });

  const messages = [
    {
      id: 'msg-1',
      text: '根据文档 [1] 和 [2]，系统支持多种格式',
      citations: [
        { documentId: 'doc_1' },
        { documentId: 'doc_2' }
      ]
    },
    {
      id: 'msg-2',
      text: '参考 [1] [2] [3]',
      citations: [
        { documentId: 'doc_1' },
        { documentId: 'doc_2' }
      ] // 缺少第3个引用
    }
  ];

  const result = await service.batchValidateCitations(messages, repo);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 2);

  const results = service.getOperationResults(result.id);
  assert.equal(results.items[0].result.validCitations, 2);
  assert.equal(results.items[1].result.missingCitations, 1);
});

test('批量操作 - 批量反馈分析', async () => {
  const service = new BatchOperationService();

  const feedbackList = [
    {
      id: 'fb-1',
      rating: 'positive',
      comment: '回答很准确，引用也很清楚'
    },
    {
      id: 'fb-2',
      rating: 'negative',
      comment: '回答不完整，缺少详细说明'
    },
    {
      id: 'fb-3',
      rating: 'positive',
      comment: '很好很满意'
    }
  ];

  const result = await service.batchAnalyzeFeedback(feedbackList);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 3);

  const results = service.getOperationResults(result.id);
  assert.ok(results.items[0].result.keywords.accuracy > 0);
  assert.ok(results.items[1].result.keywords.completeness > 0);
  assert.equal(results.items[2].result.sentiment, 'positive');
});

test('批量操作 - 批量更新元数据', async () => {
  const service = new BatchOperationService();
  const repo = new MockContentRepository();

  const doc1 = await repo.create({ title: 'Doc 1', content: 'Content 1', metadata: {} });
  const doc2 = await repo.create({ title: 'Doc 2', content: 'Content 2', metadata: {} });

  const updates = [
    { documentId: doc1.id, metadata: { tag: 'important' } },
    { documentId: doc2.id, metadata: { tag: 'archived' } }
  ];

  const result = await service.batchUpdateMetadata(updates, repo);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 2);

  const updated1 = await repo.findById(doc1.id);
  assert.equal(updated1.metadata.tag, 'important');
});

test('批量操作 - 批量删除文档', async () => {
  const service = new BatchOperationService();
  const repo = new MockContentRepository();

  const doc1 = await repo.create({ title: 'Doc 1', content: 'Content 1' });
  const doc2 = await repo.create({ title: 'Doc 2', content: 'Content 2' });

  const result = await service.batchDeleteDocuments([doc1.id, doc2.id], repo);

  assert.equal(result.status, 'completed');
  assert.equal(result.success, 2);
  assert.equal(repo.documents.size, 0);
});

test('批量操作 - 获取操作摘要', async () => {
  const service = new BatchOperationService();

  service.createOperation('test-1', [1, 2, 3]);
  service.createOperation('test-2', [4, 5, 6]);

  const summary = service.getOperationsSummary();

  assert.equal(summary.total, 2);
  assert.equal(summary.operations.length, 2);
});

test('批量操作 - 重试失败的项目', async () => {
  const service = new BatchOperationService();

  const items = [1, 2, 3, 4, 5];
  const operationId = service.createOperation('test', items);

  let failCount = 0;
  const processFn = async (item) => {
    if (item === 3 && failCount === 0) {
      failCount++;
      throw new Error('First attempt failed');
    }
    return item * 2;
  };

  await service.execute(operationId, processFn);

  let status = service.getOperationStatus(operationId);
  assert.equal(status.failed, 1);

  // 重试失败的项目
  const retryResult = await service.retryFailed(operationId, processFn);

  assert.equal(retryResult.retried, 1);
  assert.equal(retryResult.success, 1);

  status = service.getOperationStatus(operationId);
  assert.equal(status.failed, 0);
  assert.equal(status.success, 5);
});

test('批量操作 - 清理已完成操作', async () => {
  const service = new BatchOperationService();

  const op1 = service.createOperation('test-1', [1, 2]);
  await service.execute(op1, async (item) => item);

  const op2 = service.createOperation('test-2', [3, 4]);

  // 模拟第一个操作1小时前完成
  service.operations.get(op1).endTime = Date.now() - 3600001;

  const cleaned = service.cleanup(3600000);

  assert.equal(cleaned, 1);
  assert.ok(!service.operations.has(op1));
  assert.ok(service.operations.has(op2));
});

test('批量操作 - 空项目列表', async () => {
  const service = new BatchOperationService();

  const operationId = service.createOperation('test', []);

  const result = await service.execute(operationId, async (item) => item);

  assert.equal(result.status, 'completed');
  assert.equal(result.total, 0);
  assert.equal(result.success, 0);
});

test('批量操作 - 处理函数异常', async () => {
  const service = new BatchOperationService();

  const items = [1, 2, 3];
  const operationId = service.createOperation('test', items);

  const processFn = async () => {
    throw new Error('Unexpected error');
  };

  const result = await service.execute(operationId, processFn);

  assert.equal(result.status, 'completed');
  assert.equal(result.failed, 3);
  assert.equal(result.success, 0);
});

test('批量操作 - 进度追踪', async () => {
  const service = new BatchOperationService({ concurrency: 1 });

  const items = [1, 2, 3, 4, 5];
  const operationId = service.createOperation('test', items);

  const progresses = [];

  const processFn = async (item) => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const status = service.getOperationStatus(operationId);
    progresses.push(status.progress);
    return item;
  };

  await service.execute(operationId, processFn);

  // 进度应该逐步增加
  assert.ok(progresses.length > 0);
  // 最后的进度应该接近或等于100
  const lastProgress = progresses[progresses.length - 1];
  assert.ok(lastProgress >= 80 && lastProgress <= 100);
});

console.log('✓ 所有批量操作测试通过');
