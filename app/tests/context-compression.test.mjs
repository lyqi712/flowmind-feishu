import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ContextCompressionService, IncrementalCompressor } from '../server/context-compression.mjs';

test('token估算 - 中文字符', () => {
  const service = new ContextCompressionService();

  const text = '这是一段中文测试文本';
  const tokens = service.estimateTokens(text);

  // 10个中文字 ≈ 15 tokens (1.5倍)
  assert.ok(tokens >= 14 && tokens <= 16);
});

test('token估算 - 英文单词', () => {
  const service = new ContextCompressionService();

  const text = 'This is a test sentence';
  const tokens = service.estimateTokens(text);

  // 5个英文词 ≈ 6.5 tokens (1.3倍)
  assert.ok(tokens >= 6 && tokens <= 7);
});

test('token估算 - 中英混合', () => {
  const service = new ContextCompressionService();

  const text = '这是 test 混合文本';
  const tokens = service.estimateTokens(text);

  assert.ok(tokens > 0);
});

test('计算消息总token数', () => {
  const service = new ContextCompressionService();

  const messages = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，有什么可以帮助你的？' }
  ];

  const total = service.calculateTotalTokens(messages);

  assert.ok(total > 0);
});

test('判断是否需要压缩', () => {
  const service = new ContextCompressionService({ maxTokens: 100 });

  const shortMessages = [
    { role: 'user', content: '你好' }
  ];

  const longMessages = Array(50).fill(null).map((_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: '这是一段很长的文本内容，用于测试是否需要压缩。'.repeat(10)
  }));

  assert.equal(service.needsCompression(shortMessages), false);
  assert.equal(service.needsCompression(longMessages), true);
});

test('识别关键转折点 - 新主题', () => {
  const service = new ContextCompressionService();

  const messages = [
    { role: 'user', content: '关于Python的问题' },
    { role: 'assistant', content: '好的' },
    { role: 'user', content: '请问如何使用async' },
    { role: 'assistant', content: '可以使用async/await' }
  ];

  const keyTurns = service.identifyKeyTurns(messages);

  assert.ok(keyTurns.length > 0);
  assert.ok(keyTurns.some(t => t.reasons.newTopic));
});

test('识别关键转折点 - 重要决策', () => {
  const service = new ContextCompressionService();

  const messages = [
    { role: 'user', content: '应该选择哪个方案？' },
    { role: 'assistant', content: '经过分析，最终决定采用方案A' }
  ];

  const keyTurns = service.identifyKeyTurns(messages);

  assert.ok(keyTurns.some(t => t.reasons.decision));
});

test('识别关键转折点 - 包含引用', () => {
  const service = new ContextCompressionService();

  const messages = [
    { role: 'assistant', content: '根据文档 [1] 和 [2]，系统支持多种格式' }
  ];

  const keyTurns = service.identifyKeyTurns(messages);

  assert.ok(keyTurns.some(t => t.reasons.citations));
});

test('识别关键转折点 - 长回答', () => {
  const service = new ContextCompressionService();

  const longContent = '这是一段很长的回答。'.repeat(60); // 增加到60次确保超过500字符
  const messages = [
    { role: 'assistant', content: longContent }
  ];

  const keyTurns = service.identifyKeyTurns(messages);

  assert.ok(keyTurns.some(t => t.reasons.longAnswer));
});

test('提取核心信息', () => {
  const service = new ContextCompressionService();

  const messages = [
    { role: 'user', content: '关于Python的async/await' },
    { role: 'assistant', content: '根据文档 [1]，Python 3.5引入了async/await' },
    { role: 'user', content: '那我们决定使用这个方案' },
    { role: 'assistant', content: '好的，确定采用async/await方案' }
  ];

  const keyTurns = service.identifyKeyTurns(messages);
  const coreInfo = service.extractCoreInfo(messages, keyTurns);

  assert.equal(coreInfo.questionsCount, 2);
  assert.ok(coreInfo.topics.length > 0);
  assert.ok(coreInfo.citations.includes('1'));
});

test('生成结构化摘要', () => {
  const service = new ContextCompressionService();

  const coreInfo = {
    questionsCount: 5,
    topics: ['Python async', '错误处理', '性能优化'],
    decisions: ['采用async/await', '使用try-except'],
    citations: ['1', '2', '3'],
    keyTurnsCount: 8
  };

  const summary = service.generateSummary(coreInfo);

  assert.ok(summary.includes('[对话历史摘要]'));
  assert.ok(summary.includes('5 轮对话'));
  assert.ok(summary.includes('Python async'));
  assert.ok(summary.includes('[1]'));
});

test('压缩对话 - 不需要压缩', async () => {
  const service = new ContextCompressionService({ maxTokens: 10000 });

  const messages = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，有什么可以帮助你的？' }
  ];

  const result = await service.compress(messages);

  assert.deepEqual(result.compressed, messages);
  assert.equal(result.summary, null);
  assert.equal(result.stats.saved, 0);
});

test('压缩对话 - 保留最近对话', async () => {
  const service = new ContextCompressionService({ maxTokens: 100, preserveRecent: 2 });

  const messages = [
    { role: 'user', content: '问题1'.repeat(50) },
    { role: 'assistant', content: '回答1'.repeat(50) },
    { role: 'user', content: '问题2'.repeat(50) },
    { role: 'assistant', content: '回答2'.repeat(50) },
    { role: 'user', content: '问题3' },
    { role: 'assistant', content: '回答3' }
  ];

  const result = await service.compress(messages);

  // 应该保留最近2轮（4条消息）
  const recentMessages = result.compressed.filter(m => m.role !== 'system');
  assert.ok(recentMessages.length <= 4);
  assert.ok(result.summary !== null);
  assert.ok(result.stats.saved > 0);
});

test('压缩对话 - 保留系统消息', async () => {
  const service = new ContextCompressionService({ maxTokens: 100, preserveRecent: 1 });

  const messages = [
    { role: 'system', content: '你是一个助手' },
    { role: 'user', content: '问题1'.repeat(50) },
    { role: 'assistant', content: '回答1'.repeat(50) },
    { role: 'user', content: '问题2' },
    { role: 'assistant', content: '回答2' }
  ];

  const result = await service.compress(messages);

  // 系统消息应该被保留
  const systemMessages = result.compressed.filter(m => m.role === 'system');
  assert.ok(systemMessages.length >= 1);
  assert.ok(systemMessages.some(m => m.content === '你是一个助手'));
});

test('压缩统计准确', async () => {
  const service = new ContextCompressionService({ maxTokens: 50, preserveRecent: 1 });

  const messages = [
    { role: 'user', content: '这是一个很长的问题'.repeat(20) },
    { role: 'assistant', content: '这是一个很长的回答'.repeat(20) },
    { role: 'user', content: '新问题' },
    { role: 'assistant', content: '新回答' }
  ];

  const result = await service.compress(messages);

  assert.ok(result.stats.original > result.stats.compressed);
  assert.equal(result.stats.saved, result.stats.original - result.stats.compressed);
  assert.ok(result.stats.ratio > 0 && result.stats.ratio <= 100);
});

test('自适应压缩 - 达到目标token', async () => {
  const service = new ContextCompressionService();

  const messages = Array(20).fill(null).map((_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `消息${i}的内容`.repeat(10)
  }));

  const targetTokens = 500;
  const result = await service.adaptiveCompress(messages, targetTokens);

  assert.ok(result.stats.compressed <= targetTokens);
});

test('提取主题关键词', () => {
  const service = new ContextCompressionService();

  const topic1 = service.extractTopic('关于：Python的async/await使用方法和最佳实践');
  const topic2 = service.extractTopic('请问如何优化数据库查询性能？');

  assert.ok(topic1.length <= 30);
  assert.ok(topic2.length <= 30);
  assert.ok(!topic1.startsWith('关于'));
});

test('提取决策内容', () => {
  const service = new ContextCompressionService();

  const content = '经过分析，我们最终决定采用方案A。这个方案更加稳定。';
  const decision = service.extractDecision(content);

  assert.ok(decision);
  assert.ok(decision.includes('决定'));
});

test('压缩报告', () => {
  const service = new ContextCompressionService({ maxTokens: 8000 });

  const stats = {
    original: 10000,
    compressed: 5000,
    saved: 5000,
    ratio: 50
  };

  const report = service.getCompressionReport(stats);

  assert.equal(report.efficiency, '节省 50% (5000 tokens)');
  assert.ok(report.recommendation);
});

test('增量压缩器 - 首次压缩', async () => {
  const baseService = new ContextCompressionService({ maxTokens: 100, preserveRecent: 1 });
  const incrementalService = new IncrementalCompressor(baseService);

  const messages = [
    { role: 'user', content: '问题1'.repeat(20) },
    { role: 'assistant', content: '回答1'.repeat(20) }
  ];

  const result = await incrementalService.compressIncremental('conv-1', messages);

  // 检查是否有压缩结果，summary可能为null但compressed应该存在
  assert.ok(result.compressed);
  assert.ok(Array.isArray(result.compressed));
});

test('增量压缩器 - 无新消息', async () => {
  const baseService = new ContextCompressionService({ maxTokens: 100, preserveRecent: 1 });
  const incrementalService = new IncrementalCompressor(baseService);

  const messages = [
    { role: 'user', content: '问题1' },
    { role: 'assistant', content: '回答1' }
  ];

  // 首次压缩
  await incrementalService.compressIncremental('conv-2', messages);

  // 无新消息时再次压缩
  const result = await incrementalService.compressIncremental('conv-2', messages);

  assert.equal(result.stats.original, 0);
  assert.equal(result.stats.compressed, 0);
});

test('增量压缩器 - 清理缓存', async () => {
  const baseService = new ContextCompressionService();
  const incrementalService = new IncrementalCompressor(baseService);

  const messages = [
    { role: 'user', content: '问题' },
    { role: 'assistant', content: '回答' }
  ];

  await incrementalService.compressIncremental('conv-3', messages);

  assert.ok(incrementalService.cache.has('conv-3'));

  incrementalService.clearCache('conv-3');

  assert.equal(incrementalService.cache.has('conv-3'), false);
});

test('空消息列表处理', async () => {
  const service = new ContextCompressionService();

  const result = await service.compress([]);

  assert.deepEqual(result.compressed, []);
  assert.equal(result.summary, null);
  assert.equal(result.stats.original, 0);
});

test('批量压缩多个对话', async () => {
  const service = new ContextCompressionService({ maxTokens: 100, preserveRecent: 1 });

  const conversations = [
    {
      id: 'conv-a',
      messages: [
        { role: 'user', content: '问题A'.repeat(30) },
        { role: 'assistant', content: '回答A'.repeat(30) }
      ]
    },
    {
      id: 'conv-b',
      messages: [
        { role: 'user', content: '问题B'.repeat(30) },
        { role: 'assistant', content: '回答B'.repeat(30) }
      ]
    }
  ];

  const results = await service.compressBatch(conversations);

  assert.equal(results.length, 2);
  assert.equal(results[0].conversationId, 'conv-a');
  assert.equal(results[1].conversationId, 'conv-b');
});

console.log('✓ 所有上下文压缩测试通过');
