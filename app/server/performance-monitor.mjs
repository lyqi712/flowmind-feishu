/**
 * AI性能监控服务
 *
 * 追踪和分析AI交互的性能指标：
 * 1. 响应时间监控（TTFB、总时长）
 * 2. Token使用统计
 * 3. 错误率追踪
 * 4. 用户满意度趋势
 * 5. 引用质量评分
 */

export class AIPerformanceMonitor {
  constructor({ reportInterval = 60000 } = {}) {
    this.metrics = new Map(); // conversationId -> metrics
    this.aggregated = {
      requests: 0,
      errors: 0,
      totalResponseTime: 0,
      totalTokens: 0,
      feedbackPositive: 0,
      feedbackNegative: 0,
      citationQuality: []
    };
    this.reportInterval = reportInterval;
    this.startTime = Date.now();
  }

  /**
   * 开始追踪一次请求
   */
  startRequest(conversationId, messageId, context = {}) {
    const requestId = `${conversationId}:${messageId}`;

    this.metrics.set(requestId, {
      conversationId,
      messageId,
      startTime: Date.now(),
      ttfb: null, // Time to first byte
      endTime: null,
      duration: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      model: context.model || 'unknown',
      retrieval: context.hasRetrieval || false,
      evidenceCount: context.evidenceCount || 0,
      error: null,
      retries: 0,
      compressed: context.compressed || false
    });

    return requestId;
  }

  /**
   * 记录首字节时间
   */
  recordFirstByte(requestId) {
    const metric = this.metrics.get(requestId);
    if (metric && !metric.ttfb) {
      metric.ttfb = Date.now() - metric.startTime;
    }
  }

  /**
   * 记录请求完成
   */
  endRequest(requestId, result = {}) {
    const metric = this.metrics.get(requestId);
    if (!metric) return;

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.inputTokens = result.inputTokens || 0;
    metric.outputTokens = result.outputTokens || 0;
    metric.totalTokens = metric.inputTokens + metric.outputTokens;

    // 更新聚合统计
    this.aggregated.requests++;
    this.aggregated.totalResponseTime += metric.duration;
    this.aggregated.totalTokens += metric.totalTokens;
  }

  /**
   * 记录错误
   */
  recordRequest({
    requestId = '',
    provider = 'unknown',
    model = 'unknown',
    ttfb = 0,
    duration = 0,
    inputTokens = 0,
    outputTokens = 0,
    success = true,
    error = null
  } = {}) {
    const id = String(requestId || `anon:${Date.now()}`);
    const totalTokens = (Number(inputTokens) || 0) + (Number(outputTokens) || 0);
    this.metrics.set(id, {
      conversationId: null,
      messageId: id,
      startTime: Date.now() - (Number(duration) || 0),
      ttfb: Number(ttfb) || 0,
      endTime: Date.now(),
      duration: Number(duration) || 0,
      inputTokens: Number(inputTokens) || 0,
      outputTokens: Number(outputTokens) || 0,
      totalTokens,
      model,
      provider,
      retrieval: false,
      evidenceCount: 0,
      error: success ? null : { message: String(error?.message || error || ''), timestamp: Date.now() },
      retries: 0,
      compressed: false
    });
    this.aggregated.requests += 1;
    if (!success) this.aggregated.errors += 1;
    this.aggregated.totalResponseTime += Number(duration) || 0;
    this.aggregated.totalTokens += totalTokens;
  }

  getMetrics() {
    return this.getStatistics();
  }

  recordError(requestId, error, errorType) {
    const metric = this.metrics.get(requestId);
    if (metric) {
      metric.error = {
        type: errorType,
        message: String(error?.message || error || ''),
        timestamp: Date.now()
      };
      metric.endTime = Date.now();
      metric.duration = metric.endTime - metric.startTime;
    }

    this.aggregated.errors++;
  }

  /**
   * 记录重试
   */
  recordRetry(requestId) {
    const metric = this.metrics.get(requestId);
    if (metric) {
      metric.retries++;
    }
  }

  /**
   * 记录用户反馈
   */
  recordFeedback(conversationId, messageId, rating, citationQuality = null) {
    if (rating === 'positive') {
      this.aggregated.feedbackPositive++;
    } else if (rating === 'negative') {
      this.aggregated.feedbackNegative++;
    }

    if (citationQuality !== null) {
      this.aggregated.citationQuality.push({
        conversationId,
        messageId,
        quality: citationQuality,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 获取请求指标
   */
  getRequestMetrics(requestId) {
    return this.metrics.get(requestId);
  }

  /**
   * 获取对话所有请求的指标
   */
  getConversationMetrics(conversationId) {
    const requests = [];
    for (const [requestId, metric] of this.metrics.entries()) {
      if (metric.conversationId === conversationId) {
        requests.push({ requestId, ...metric });
      }
    }
    return requests;
  }

  /**
   * 计算统计摘要
   */
  getStatistics() {
    const { requests, errors, totalResponseTime, totalTokens } = this.aggregated;

    const avgResponseTime = requests > 0 ? Math.round(totalResponseTime / requests) : 0;
    const avgTokens = requests > 0 ? Math.round(totalTokens / requests) : 0;
    const errorRate = requests > 0 ? Math.round((errors / requests) * 100) : 0;

    const feedbackTotal = this.aggregated.feedbackPositive + this.aggregated.feedbackNegative;
    const satisfactionRate = feedbackTotal > 0
      ? Math.round((this.aggregated.feedbackPositive / feedbackTotal) * 100)
      : 0;

    // 计算最近1小时的引用质量平均值
    const oneHourAgo = Date.now() - 3600000;
    const recentCitations = this.aggregated.citationQuality.filter(c => c.timestamp > oneHourAgo);
    const avgCitationQuality = recentCitations.length > 0
      ? Math.round(recentCitations.reduce((sum, c) => sum + c.quality, 0) / recentCitations.length)
      : 0;

    return {
      requests,
      errors,
      errorRate,
      avgResponseTime,
      avgTokens,
      totalTokens,
      feedbackTotal,
      satisfactionRate,
      avgCitationQuality,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * 获取性能分位数
   */
  getPercentiles() {
    const durations = [];
    const ttfbs = [];

    for (const metric of this.metrics.values()) {
      if (metric.duration) durations.push(metric.duration);
      if (metric.ttfb) ttfbs.push(metric.ttfb);
    }

    if (durations.length === 0) {
      return { p50: 0, p95: 0, p99: 0, ttfbP50: 0, ttfbP95: 0 };
    }

    durations.sort((a, b) => a - b);
    ttfbs.sort((a, b) => a - b);

    const percentile = (arr, p) => {
      const index = Math.ceil((arr.length * p) / 100) - 1;
      return arr[Math.max(0, index)] || 0;
    };

    return {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      ttfbP50: percentile(ttfbs, 50),
      ttfbP95: percentile(ttfbs, 95)
    };
  }

  /**
   * 获取错误分布
   */
  getErrorBreakdown() {
    const breakdown = {};

    for (const metric of this.metrics.values()) {
      if (metric.error) {
        const type = metric.error.type || 'unknown';
        breakdown[type] = (breakdown[type] || 0) + 1;
      }
    }

    return breakdown;
  }

  /**
   * 获取模型使用统计
   */
  getModelStats() {
    const stats = {};

    for (const metric of this.metrics.values()) {
      const model = metric.model;
      if (!stats[model]) {
        stats[model] = {
          requests: 0,
          totalTokens: 0,
          totalDuration: 0,
          errors: 0
        };
      }

      stats[model].requests++;
      stats[model].totalTokens += metric.totalTokens;
      if (metric.duration) stats[model].totalDuration += metric.duration;
      if (metric.error) stats[model].errors++;
    }

    // 计算平均值
    for (const model in stats) {
      const s = stats[model];
      s.avgTokens = s.requests > 0 ? Math.round(s.totalTokens / s.requests) : 0;
      s.avgDuration = s.requests > 0 ? Math.round(s.totalDuration / s.requests) : 0;
      s.errorRate = s.requests > 0 ? Math.round((s.errors / s.requests) * 100) : 0;
    }

    return stats;
  }

  /**
   * 获取时间序列数据（用于趋势图）
   */
  getTimeSeries(interval = 300000) { // 默认5分钟间隔
    const buckets = new Map();
    const now = Date.now();

    for (const metric of this.metrics.values()) {
      if (!metric.startTime) continue;

      const bucketTime = Math.floor(metric.startTime / interval) * interval;

      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, {
          timestamp: bucketTime,
          requests: 0,
          errors: 0,
          totalDuration: 0,
          totalTokens: 0
        });
      }

      const bucket = buckets.get(bucketTime);
      bucket.requests++;
      if (metric.error) bucket.errors++;
      if (metric.duration) bucket.totalDuration += metric.duration;
      bucket.totalTokens += metric.totalTokens;
    }

    // 转换为数组并计算平均值
    const series = Array.from(buckets.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(bucket => ({
        ...bucket,
        avgDuration: bucket.requests > 0 ? Math.round(bucket.totalDuration / bucket.requests) : 0,
        avgTokens: bucket.requests > 0 ? Math.round(bucket.totalTokens / bucket.requests) : 0,
        errorRate: bucket.requests > 0 ? Math.round((bucket.errors / bucket.requests) * 100) : 0
      }));

    return series;
  }

  /**
   * 生成性能报告
   */
  generateReport() {
    const stats = this.getStatistics();
    const percentiles = this.getPercentiles();
    const errorBreakdown = this.getErrorBreakdown();
    const modelStats = this.getModelStats();

    return {
      timestamp: new Date().toISOString(),
      uptime: stats.uptime,
      summary: {
        requests: stats.requests,
        errors: stats.errors,
        errorRate: stats.errorRate,
        satisfactionRate: stats.satisfactionRate,
        avgCitationQuality: stats.avgCitationQuality
      },
      performance: {
        avgResponseTime: stats.avgResponseTime,
        p50: percentiles.p50,
        p95: percentiles.p95,
        p99: percentiles.p99,
        ttfbP50: percentiles.ttfbP50,
        ttfbP95: percentiles.ttfbP95
      },
      tokens: {
        total: stats.totalTokens,
        avgPerRequest: stats.avgTokens
      },
      errors: errorBreakdown,
      models: modelStats
    };
  }

  /**
   * 清理旧指标（保留最近1小时）
   */
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [requestId, metric] of this.metrics.entries()) {
      if (now - metric.startTime > maxAge) {
        this.metrics.delete(requestId);
        cleaned++;
      }
    }

    // 清理旧的引用质量数据
    this.aggregated.citationQuality = this.aggregated.citationQuality.filter(
      c => now - c.timestamp <= maxAge
    );

    return cleaned;
  }

  /**
   * 导出指标数据
   */
  exportMetrics() {
    return {
      metrics: Array.from(this.metrics.entries()).map(([id, metric]) => ({ id, ...metric })),
      aggregated: this.aggregated,
      timestamp: Date.now()
    };
  }

  /**
   * 检测性能异常
   */
  detectAnomalies() {
    const stats = this.getStatistics();
    const percentiles = this.getPercentiles();
    const anomalies = [];

    // 错误率过高
    if (stats.errorRate > 10) {
      anomalies.push({
        type: 'high-error-rate',
        severity: stats.errorRate > 20 ? 'critical' : 'warning',
        value: stats.errorRate,
        message: `错误率 ${stats.errorRate}% 超过阈值`
      });
    }

    // 响应时间过长
    if (percentiles.p95 > 10000) {
      anomalies.push({
        type: 'slow-response',
        severity: percentiles.p95 > 20000 ? 'critical' : 'warning',
        value: percentiles.p95,
        message: `P95响应时间 ${percentiles.p95}ms 过长`
      });
    }

    // 满意度过低
    if (stats.feedbackTotal > 10 && stats.satisfactionRate < 60) {
      anomalies.push({
        type: 'low-satisfaction',
        severity: stats.satisfactionRate < 40 ? 'critical' : 'warning',
        value: stats.satisfactionRate,
        message: `用户满意度 ${stats.satisfactionRate}% 过低`
      });
    }

    // 引用质量过低
    if (stats.avgCitationQuality > 0 && stats.avgCitationQuality < 60) {
      anomalies.push({
        type: 'poor-citation-quality',
        severity: stats.avgCitationQuality < 40 ? 'critical' : 'warning',
        value: stats.avgCitationQuality,
        message: `引用质量 ${stats.avgCitationQuality}% 过低`
      });
    }

    return anomalies;
  }
}
