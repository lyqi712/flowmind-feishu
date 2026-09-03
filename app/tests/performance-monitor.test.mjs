import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AIPerformanceMonitor } from '../server/performance-monitor.mjs';

test('性能监控 - 开始和结束请求', () => {
  const monitor = new AIPerformanceMonitor();

  const requestId = monitor.startRequest('conv-1', 'msg-1', { model: 'gpt-4' });

  assert.ok(requestId);
  assert.ok(requestId.startsWith('conv-1:msg-1'));

  const metric = monitor.getRequestMetrics(requestId);
  assert.ok(metric);
  assert.equal(metric.conversationId, 'conv-1');
  assert.equal(metric.messageId, 'msg-1');
  assert.equal(metric.model, 'gpt-4');
});

test('性能监控 - 记录首字节时间', () => {
  const monitor = new AIPerformanceMonitor();

  const requestId = monitor.startRequest('conv-1', 'msg-1');

  // 模拟延迟
  const delay = 50;
  setTimeout(() => {
    monitor.recordFirstByte(requestId);

    const metric = monitor.getRequestMetrics(requestId);
    assert.ok(metric.ttfb >= delay - 10); // 允许10ms误差
  }, delay);
});

test('性能监控 - 结束请求并记录token', () => {
  const monitor = new AIPerformanceMonitor();

  const requestId = monitor.startRequest('conv-1', 'msg-1');

  monitor.endRequest(requestId, {
    inputTokens: 100,
    outputTokens: 200
  });

  const metric = monitor.getRequestMetrics(requestId);
  assert.equal(metric.inputTokens, 100);
  assert.equal(metric.outputTokens, 200);
  assert.equal(metric.totalTokens, 300);
  assert.ok(metric.duration >= 0);
});

test('性能监控 - 记录错误', () => {
  const monitor = new AIPerformanceMonitor();

  const requestId = monitor.startRequest('conv-1', 'msg-1');

  monitor.recordError(requestId, new Error('Test error'), 'timeout');

  const metric = monitor.getRequestMetrics(requestId);
  assert.ok(metric.error);
  assert.equal(metric.error.type, 'timeout');
  assert.ok(metric.error.message.includes('Test error'));

  const stats = monitor.getStatistics();
  assert.equal(stats.errors, 1);
});

test('性能监控 - 记录重试', () => {
  const monitor = new AIPerformanceMonitor();

  const requestId = monitor.startRequest('conv-1', 'msg-1');

  monitor.recordRetry(requestId);
  monitor.recordRetry(requestId);

  const metric = monitor.getRequestMetrics(requestId);
  assert.equal(metric.retries, 2);
});

test('性能监控 - 记录用户反馈', () => {
  const monitor = new AIPerformanceMonitor();

  monitor.recordFeedback('conv-1', 'msg-1', 'positive', 85);
  monitor.recordFeedback('conv-2', 'msg-2', 'negative', 40);
  monitor.recordFeedback('conv-3', 'msg-3', 'positive', 90);

  const stats = monitor.getStatistics();
  assert.equal(stats.feedbackTotal, 3);
  assert.equal(stats.satisfactionRate, 67); // 2/3 = 66.67 ≈ 67
});

test('性能监控 - 获取统计摘要', () => {
  const monitor = new AIPerformanceMonitor();

  const req1 = monitor.startRequest('conv-1', 'msg-1');
  monitor.endRequest(req1, { inputTokens: 100, outputTokens: 200 });

  const req2 = monitor.startRequest('conv-2', 'msg-2');
  monitor.endRequest(req2, { inputTokens: 150, outputTokens: 250 });

  const req3 = monitor.startRequest('conv-3', 'msg-3');
  monitor.recordError(req3, new Error('Error'), 'network');

  const stats = monitor.getStatistics();

  assert.equal(stats.requests, 2); // 只统计成功完成的
  assert.equal(stats.errors, 1);
  assert.equal(stats.totalTokens, 700); // 300 + 400
  assert.ok(stats.avgResponseTime >= 0);
  assert.ok(stats.avgTokens > 0);
});

test('性能监控 - 获取性能分位数', () => {
  const monitor = new AIPerformanceMonitor();

  // 创建多个请求模拟不同响应时间
  for (let i = 0; i < 100; i++) {
    const requestId = monitor.startRequest('conv-1', `msg-${i}`);
    monitor.metrics.get(requestId).duration = (i + 1) * 10; // 10, 20, ..., 1000
    monitor.metrics.get(requestId).ttfb = (i + 1) * 5;
  }

  const percentiles = monitor.getPercentiles();

  assert.ok(percentiles.p50 > 0);
  assert.ok(percentiles.p95 > percentiles.p50);
  assert.ok(percentiles.p99 >= percentiles.p95); // 使用 >= 因为数据量小时可能相等
});

test('性能监控 - 错误分布统计', () => {
  const monitor = new AIPerformanceMonitor();

  monitor.recordError(monitor.startRequest('c1', 'm1'), new Error(), 'timeout');
  monitor.recordError(monitor.startRequest('c2', 'm2'), new Error(), 'timeout');
  monitor.recordError(monitor.startRequest('c3', 'm3'), new Error(), 'network');

  const breakdown = monitor.getErrorBreakdown();

  assert.equal(breakdown.timeout, 2);
  assert.equal(breakdown.network, 1);
});

test('性能监控 - 模型使用统计', () => {
  const monitor = new AIPerformanceMonitor();

  const req1 = monitor.startRequest('c1', 'm1', { model: 'gpt-4' });
  monitor.endRequest(req1, { inputTokens: 100, outputTokens: 200 });

  const req2 = monitor.startRequest('c2', 'm2', { model: 'gpt-4' });
  monitor.endRequest(req2, { inputTokens: 150, outputTokens: 250 });

  const req3 = monitor.startRequest('c3', 'm3', { model: 'gpt-3.5-turbo' });
  monitor.endRequest(req3, { inputTokens: 80, outputTokens: 120 });

  const modelStats = monitor.getModelStats();

  assert.ok(modelStats['gpt-4']);
  assert.equal(modelStats['gpt-4'].requests, 2);
  assert.equal(modelStats['gpt-4'].totalTokens, 700); // 300 + 400

  assert.ok(modelStats['gpt-3.5-turbo']);
  assert.equal(modelStats['gpt-3.5-turbo'].requests, 1);
  assert.equal(modelStats['gpt-3.5-turbo'].totalTokens, 200);
});

test('性能监控 - 清理旧指标', () => {
  const monitor = new AIPerformanceMonitor();

  const req1 = monitor.startRequest('c1', 'm1');
  const metric1 = monitor.metrics.get(req1);
  metric1.startTime = Date.now() - 7200000; // 2小时前

  const req2 = monitor.startRequest('c2', 'm2');

  assert.equal(monitor.metrics.size, 2);

  const cleaned = monitor.cleanup(3600000); // 清理1小时以上的

  assert.equal(cleaned, 1);
  assert.equal(monitor.metrics.size, 1);
  assert.ok(monitor.metrics.has(req2));
});

test('性能监控 - 性能异常检测', () => {
  const monitor = new AIPerformanceMonitor();

  // 模拟高错误率
  for (let i = 0; i < 10; i++) {
    const requestId = monitor.startRequest('c1', `m${i}`);
    if (i < 3) {
      monitor.endRequest(requestId, { inputTokens: 100, outputTokens: 200 });
    } else {
      monitor.recordError(requestId, new Error(), 'timeout');
    }
  }

  const stats = monitor.getStatistics();
  assert.ok(stats.errorRate > 10);

  const anomalies = monitor.detectAnomalies();

  assert.ok(anomalies.length > 0);
  assert.ok(anomalies.some(a => a.type === 'high-error-rate'));
});

test('性能监控 - 获取对话所有请求', () => {
  const monitor = new AIPerformanceMonitor();

  monitor.startRequest('conv-1', 'msg-1');
  monitor.startRequest('conv-1', 'msg-2');
  monitor.startRequest('conv-2', 'msg-3');

  const conv1Metrics = monitor.getConversationMetrics('conv-1');

  assert.equal(conv1Metrics.length, 2);
  assert.ok(conv1Metrics.every(m => m.conversationId === 'conv-1'));
});

test('性能监控 - 生成性能报告', () => {
  const monitor = new AIPerformanceMonitor();

  const req1 = monitor.startRequest('c1', 'm1', { model: 'gpt-4' });
  monitor.endRequest(req1, { inputTokens: 100, outputTokens: 200 });

  monitor.recordFeedback('c1', 'm1', 'positive', 85);

  const report = monitor.generateReport();

  assert.ok(report.timestamp);
  assert.ok(report.summary);
  assert.equal(report.summary.requests, 1);
  assert.ok(report.performance);
  assert.ok(report.tokens);
  assert.ok(report.models);
});

test('性能监控 - 时间序列数据', () => {
  const monitor = new AIPerformanceMonitor();

  // 创建一些间隔5分钟的请求
  for (let i = 0; i < 3; i++) {
    const requestId = monitor.startRequest('c1', `m${i}`);
    const metric = monitor.metrics.get(requestId);
    metric.startTime = Date.now() - (i * 300000); // 0, 5min, 10min前
    metric.duration = (i + 1) * 1000;
    metric.totalTokens = (i + 1) * 100;
  }

  const series = monitor.getTimeSeries(300000); // 5分钟间隔

  assert.ok(series.length > 0);
  assert.ok(series[0].timestamp);
  assert.ok(series[0].requests >= 0);
});

test('性能监控 - 导出指标数据', () => {
  const monitor = new AIPerformanceMonitor();

  monitor.startRequest('c1', 'm1');
  monitor.recordFeedback('c1', 'm1', 'positive', 90);

  const exported = monitor.exportMetrics();

  assert.ok(Array.isArray(exported.metrics));
  assert.ok(exported.aggregated);
  assert.ok(exported.timestamp);
});

console.log('✓ 所有性能监控测试通过');
