import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ErrorRecoveryService } from '../server/error-recovery.mjs';

// Mock服务
class MockModelService {}
class MockRetrieval {}

test('错误分类 - rate limit', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error1 = new Error('Rate limit exceeded');
  const error2 = { code: 'rate_limit_exceeded' };

  assert.equal(service.classifyError(error1), 'rate-limit');
  assert.equal(service.classifyError(error2), 'rate-limit');
});

test('错误分类 - timeout', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error1 = new Error('Request timed out');
  const error2 = { code: 'timeout' };

  assert.equal(service.classifyError(error1), 'timeout');
  assert.equal(service.classifyError(error2), 'timeout');
});

test('错误分类 - token limit', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = new Error('Context length exceeded');

  assert.equal(service.classifyError(error), 'token-limit');
});

test('错误分类 - content policy', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = { code: 'content_policy_violation' };

  assert.equal(service.classifyError(error), 'content-policy');
});

test('错误可恢复性判断', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  // rate-limit 最多重试2次
  assert.equal(service.isRecoverable('rate-limit', 0), true);
  assert.equal(service.isRecoverable('rate-limit', 1), true);
  assert.equal(service.isRecoverable('rate-limit', 2), false);

  // content-policy 不可重试
  assert.equal(service.isRecoverable('content-policy', 0), false);

  // timeout 最多重试3次
  assert.equal(service.isRecoverable('timeout', 2), true);
  assert.equal(service.isRecoverable('timeout', 3), false);
});

test('恢复策略 - rate limit 指数退避', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const strategy0 = service.selectStrategy('rate-limit', 0, {});
  const strategy1 = service.selectStrategy('rate-limit', 1, {});

  assert.equal(strategy0.action, 'retry');
  assert.equal(strategy0.delay, 1000); // 2^0 * 1000

  assert.equal(strategy1.action, 'retry');
  assert.equal(strategy1.delay, 2000); // 2^1 * 1000
});

test('恢复策略 - timeout 增加超时时间', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const strategy = service.selectStrategy('timeout', 0, { timeout: 30000 });

  assert.equal(strategy.action, 'retry');
  assert.equal(strategy.modify.timeout, 45000); // 30000 * 1.5
});

test('恢复策略 - token limit 压缩上下文', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const strategy = service.selectStrategy('token-limit', 0, { maxContextTokens: 10000 });

  assert.equal(strategy.action, 'compress');
  assert.equal(strategy.modify.maxContextTokens, 7000); // 10000 * 0.7
  assert.equal(strategy.modify.summarizeHistory, true);
});

test('恢复策略 - model unavailable 无备用模型时诚实失败', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const strategy = service.selectStrategy('model-unavailable', 0, { model: 'deepseek-chat' });

  assert.equal(strategy.action, 'fail');
  assert.match(strategy.modify.userMessage, /换一个可用模型/);
});

test('降级模型只使用用户配置的备用模型', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  assert.equal(service.selectFallbackModel('deepseek-chat'), null);
  assert.equal(service.selectFallbackModel('gpt-4', { fallbackModel: 'gpt-3.5-turbo' }), 'gpt-3.5-turbo');
  assert.equal(service.selectFallbackModel('gpt-4', { fallbackModel: 'gpt-4' }), null);
  const strategy = service.selectStrategy('model-unavailable', 0, { model: 'deepseek-chat', fallbackModel: 'deepseek-chat-lite' });
  assert.equal(strategy.action, 'fallback');
  assert.equal(strategy.modify.model, 'deepseek-chat-lite');
});

test('用户友好错误建议', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const suggestion1 = service.generateSuggestion('rate-limit', 0, {});
  const suggestion2 = service.generateSuggestion('rate-limit', 2, {});

  assert.ok(suggestion1.includes('稍后'));
  assert.ok(suggestion2.includes('限流'));
});

test('错误记录和历史', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const conversationId = 'test-conv-123';
  const error1 = new Error('Timeout 1');
  const error2 = new Error('Timeout 2');

  service.recordError(conversationId, error1, 'timeout');
  service.recordError(conversationId, error2, 'timeout');

  const history = service.getErrorHistory(conversationId);

  assert.equal(history.length, 2);
  assert.equal(history[0].type, 'timeout');
  assert.equal(history[1].type, 'timeout');
});

test('错误历史清理', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const conversationId = 'test-conv-456';

  // 记录一个旧错误（时间戳设为1小时前）
  service.errorHistory.set(conversationId, [{
    type: 'timeout',
    timestamp: Date.now() - 3600001, // 1小时1秒前
    message: 'old error'
  }]);

  // 清理1小时以上的错误
  service.cleanup(3600000);

  assert.equal(service.errorHistory.has(conversationId), false);
});

test('分析错误返回完整信息', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = new Error('Rate limit exceeded');
  const context = { conversationId: 'test-789' };

  const analysis = service.analyzeError(error, context);

  assert.equal(analysis.type, 'rate-limit');
  assert.equal(analysis.recoverable, true);
  assert.ok(analysis.strategy);
  assert.equal(analysis.retryCount, 0);
  assert.ok(analysis.suggestion);
});

test('多次同类型错误后不可恢复', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const conversationId = 'test-multi-error';
  const error = new Error('Timeout');

  // 记录3次timeout错误
  service.recordError(conversationId, error, 'timeout');
  service.recordError(conversationId, error, 'timeout');
  service.recordError(conversationId, error, 'timeout');

  const analysis = service.analyzeError(error, { conversationId });

  assert.equal(analysis.type, 'timeout');
  assert.equal(analysis.retryCount, 3);
  assert.equal(analysis.recoverable, false); // 超过最大重试次数
});

test('content-policy 错误立即失败', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = { code: 'content_policy_violation' };
  const context = { conversationId: 'test-policy' };

  const analysis = service.analyzeError(error, context);

  assert.equal(analysis.type, 'content-policy');
  assert.equal(analysis.recoverable, false);
  assert.equal(analysis.strategy.action, 'fail');
  assert.ok(analysis.suggestion.includes('策略') || analysis.suggestion.includes('政策'));
});

test('网络错误重试策略', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = { code: 'ECONNREFUSED' };
  const analysis = service.analyzeError(error, { conversationId: 'test-network' });

  assert.equal(analysis.type, 'network');
  assert.equal(analysis.recoverable, true);
  assert.equal(analysis.strategy.action, 'retry');
  assert.equal(analysis.strategy.delay, 3000);
});

test('未知错误默认重试一次', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = new Error('Some unknown error');
  const analysis = service.analyzeError(error, { conversationId: 'test-unknown' });

  assert.equal(analysis.type, 'unknown');
  assert.equal(analysis.recoverable, true); // 第一次
  assert.equal(analysis.strategy.action, 'retry');
});

test('引用错误禁用引用后重试', () => {
  const service = new ErrorRecoveryService({ modelService: new MockModelService(), retrieval: new MockRetrieval() });

  const error = new Error('Citation generation failed');
  const analysis = service.analyzeError(error, { conversationId: 'test-citation' });

  assert.equal(analysis.type, 'citation-error');
  assert.equal(analysis.strategy.action, 'retry');
  assert.equal(analysis.strategy.modify.disableCitations, true);
  assert.equal(analysis.strategy.modify.simpleAnswer, true);
});

console.log('✓ 所有错误恢复测试通过');
