/**
 * 智能错误恢复机制
 *
 * 当AI回答出错时自动诊断问题并采取恢复策略：
 * 1. 检测错误类型（API错误、超时、内容违规、引用错误）
 * 2. 根据错误类型选择恢复策略
 * 3. 自动重试、降级、或提示用户
 */

export class ErrorRecoveryService {
  constructor({ modelService, retrieval } = {}) {
    this.modelService = modelService || null;
    this.retrieval = retrieval || null;
    this.errorHistory = new Map(); // conversationId -> error records
  }

  /**
   * 分析错误并返回恢复策略
   */
  analyzeError(error, context = {}) {
    const errorType = this.classifyError(error);
    const history = this.getErrorHistory(context.conversationId);
    const retryCount = history.filter(e => e.type === errorType).length;

    return {
      type: errorType,
      recoverable: this.isRecoverable(errorType, retryCount),
      strategy: this.selectStrategy(errorType, retryCount, context),
      retryCount,
      suggestion: this.generateSuggestion(errorType, retryCount, context)
    };
  }

  /**
   * 错误分类
   */
  classifyError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    const code = error?.code || error?.error?.code || '';

    // API限流或配额
    if (code === 'rate_limit_exceeded' || /rate limit|too many requests/i.test(message)) {
      return 'rate-limit';
    }

    // 超时
    if (code === 'timeout' || /timeout|timed out/i.test(message)) {
      return 'timeout';
    }

    // 内容审核
    if (code === 'content_policy_violation' || /content policy|inappropriate/i.test(message)) {
      return 'content-policy';
    }

    // 引用生成错误
    if (/citation|reference|evidence/i.test(message)) {
      return 'citation-error';
    }

    // 模型不可用
    if (code === 'model_not_found' || /model not found|unavailable/i.test(message)) {
      return 'model-unavailable';
    }

    // 网络错误
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /network|connection/i.test(message)) {
      return 'network';
    }

    // token超限
    if (/token limit|context length|too long/i.test(message)) {
      return 'token-limit';
    }

    return 'unknown';
  }

  /**
   * 判断是否可恢复
   */
  isRecoverable(errorType, retryCount) {
    const maxRetries = {
      'rate-limit': 2,
      'timeout': 3,
      'network': 3,
      'citation-error': 2,
      'model-unavailable': 1,
      'token-limit': 1,
      'content-policy': 0,
      'unknown': 1
    };

    return retryCount < (maxRetries[errorType] || 0);
  }

  /**
   * 选择恢复策略
   */
  selectStrategy(errorType, retryCount, context) {
    switch (errorType) {
      case 'rate-limit':
        return {
          action: 'retry',
          delay: Math.pow(2, retryCount) * 1000, // 指数退避
          modify: null
        };

      case 'timeout':
        return {
          action: 'retry',
          delay: 2000,
          modify: { timeout: (context.timeout || 30000) * 1.5 } // 增加超时时间
        };

      case 'token-limit':
        return {
          action: 'compress',
          delay: 0,
          modify: {
            maxContextTokens: Math.floor((context.maxContextTokens || 10000) * 0.7),
            summarizeHistory: true
          }
        };

      case 'citation-error':
        return {
          action: 'retry',
          delay: 1000,
          modify: {
            disableCitations: true,
            simpleAnswer: true
          }
        };

      case 'model-unavailable': {
        const fallback = this.selectFallbackModel(context.model, context);
        if (!fallback) {
          return {
            action: 'fail',
            delay: 0,
            modify: {
              userMessage: '当前模型不可用，请在设置里换一个可用模型'
            }
          };
        }
        return {
          action: 'fallback',
          delay: 0,
          modify: {
            model: fallback,
            reason: '主模型不可用，切换到备用模型'
          }
        };
      }

      case 'network':
        return {
          action: 'retry',
          delay: 3000,
          modify: null
        };

      case 'content-policy':
        return {
          action: 'fail',
          delay: 0,
          modify: {
            userMessage: '回答内容触发了安全策略，请调整问题后重试'
          }
        };

      default:
        return {
          action: retryCount === 0 ? 'retry' : 'fail',
          delay: 2000,
          modify: null
        };
    }
  }

  /**
   * 选择降级模型
   */
  selectFallbackModel(currentModel, context = {}) {
    const current = String(currentModel || '').trim();
    const configured = String(context.fallbackModel || '').trim();
    if (configured && configured !== current) return configured;
    return null;
  }

  /**
   * 生成用户友好的错误建议
   */
  generateSuggestion(errorType, retryCount, context) {
    const suggestions = {
      'rate-limit': retryCount === 0
        ? '请求频率过高，稍后自动重试...'
        : '已达到API限流，请稍后再试',

      'timeout': retryCount < 2
        ? '响应超时，正在重试...'
        : '多次超时，请检查网络或简化问题',

      'token-limit': '上下文过长，正在压缩历史对话...',

      'citation-error': '引用生成失败，尝试简化回答...',

      'model-unavailable': `${context.model} 不可用，切换到备用模型`,

      'network': '网络连接失败，正在重试...',

      'content-policy': '内容违反使用政策，请调整问题',

      'unknown': retryCount === 0 ? '遇到未知错误，尝试重试...' : '错误持续，请联系支持'
    };

    return suggestions[errorType] || suggestions.unknown;
  }

  /**
   * 记录错误
   */
  recordError(conversationId, error, errorType) {
    if (!this.errorHistory.has(conversationId)) {
      this.errorHistory.set(conversationId, []);
    }

    const history = this.errorHistory.get(conversationId);
    history.push({
      type: errorType,
      timestamp: Date.now(),
      message: String(error?.message || error || '')
    });

    // 只保留最近20条
    if (history.length > 20) {
      history.shift();
    }
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(conversationId) {
    return this.errorHistory.get(conversationId) || [];
  }

  /**
   * 清理旧错误记录
   */
  cleanup(maxAge = 3600000) { // 默认1小时
    const now = Date.now();
    for (const [conversationId, history] of this.errorHistory.entries()) {
      const recent = history.filter(e => now - e.timestamp < maxAge);
      if (recent.length === 0) {
        this.errorHistory.delete(conversationId);
      } else {
        this.errorHistory.set(conversationId, recent);
      }
    }
  }

  /**
   * 执行恢复策略
   */
  async recover(error, context, originalFn) {
    const analysis = this.analyzeError(error, context);
    this.recordError(context.conversationId, error, analysis.type);

    if (!analysis.recoverable) {
      throw new Error(analysis.suggestion);
    }

    const { strategy } = analysis;

    // 延迟
    if (strategy.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, strategy.delay));
    }

    // 应用修改
    const modifiedContext = strategy.modify
      ? { ...context, ...strategy.modify }
      : context;

    // 执行恢复动作
    switch (strategy.action) {
      case 'retry':
        return await originalFn(modifiedContext);

      case 'compress':
        return await this.compressAndRetry(modifiedContext, originalFn);

      case 'fallback':
        return await this.fallbackAndRetry(modifiedContext, originalFn);

      case 'fail':
      default:
        throw new Error(analysis.suggestion);
    }
  }

  /**
   * 压缩上下文后重试
   */
  async compressAndRetry(context, originalFn) {
    if (context.messages && context.messages.length > 2) {
      // 保留第一条和最后一条，中间的进行摘要
      const first = context.messages[0];
      const last = context.messages[context.messages.length - 1];
      const middle = context.messages.slice(1, -1);

      const summary = await this.summarizeMessages(middle);

      context.messages = [
        first,
        { role: 'system', content: `[历史对话摘要] ${summary}` },
        last
      ];
    }

    return await originalFn(context);
  }

  /**
   * 降级模型后重试
   */
  async fallbackAndRetry(context, originalFn) {
    // 降级策略已在 strategy.modify 中设置
    return await originalFn(context);
  }

  /**
   * 总结历史消息
   */
  async summarizeMessages(messages) {
    const combined = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');

    return `用户询问了${messages.filter(m => m.role === 'user').length}个问题，助手提供了相应解答。`;
  }
}
