/**
 * 智能上下文压缩服务
 *
 * 当对话历史过长时自动压缩，保留关键信息：
 * 1. 识别关键转折点（新主题、重要决策）
 * 2. 提取核心信息（问题、结论、引用）
 * 3. 保留最近的完整对话
 * 4. 生成结构化摘要
 */

export class ContextCompressionService {
  constructor({ maxTokens = 8000, preserveRecent = 3 } = {}) {
    this.maxTokens = maxTokens;
    this.preserveRecent = preserveRecent; // 保留最近N轮完整对话
  }

  /**
   * 估算token数量（简化版，1中文字≈1.5 tokens，1英文词≈1.3 tokens）
   */
  estimateTokens(text) {
    const str = String(text || '');
    const chineseChars = (str.match(/[一-龥]/g) || []).length;
    const englishWords = str.replace(/[一-龥]/g, '').split(/\s+/).filter(Boolean).length;
    return Math.ceil(chineseChars * 1.5 + englishWords * 1.3);
  }

  /**
   * 计算消息列表的总token数
   */
  calculateTotalTokens(messages) {
    return messages.reduce((sum, msg) => {
      return sum + this.estimateTokens(msg.content || msg.text || '');
    }, 0);
  }

  /**
   * 判断是否需要压缩
   */
  needsCompression(messages, maxTokens = this.maxTokens) {
    return this.calculateTotalTokens(messages) > maxTokens;
  }

  /**
   * 压缩对话历史
   */
  async compress(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { compressed: [], summary: null, stats: { original: 0, compressed: 0, saved: 0 } };
    }

    const originalTokens = this.calculateTotalTokens(messages);
    const maxTokens = Number(options.targetTokens || options.maxTokens || this.maxTokens) || this.maxTokens;

    if (!options.force && !this.needsCompression(messages, maxTokens)) {
      return {
        compressed: messages,
        summary: null,
        stats: { original: originalTokens, compressed: originalTokens, saved: 0 }
      };
    }

    // 分离系统消息、最近消息、历史消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const recentCount = Math.min(this.preserveRecent * 2, messages.length); // *2因为一问一答
    const recentMessages = messages.slice(-recentCount);
    const historyMessages = messages.slice(systemMessages.length, -recentCount);

    // 压缩历史消息
    const historySummary = await this.summarizeHistory(historyMessages, options);

    // 构建压缩后的消息列表
    const compressed = [
      ...systemMessages,
      ...(historySummary ? [{ role: 'system', content: historySummary }] : []),
      ...recentMessages
    ];

    const compressedTokens = this.calculateTotalTokens(compressed);

    return {
      compressed,
      summary: historySummary,
      stats: {
        original: originalTokens,
        compressed: compressedTokens,
        saved: originalTokens - compressedTokens,
        ratio: Math.round((1 - compressedTokens / originalTokens) * 100)
      }
    };
  }

  /**
   * 总结历史对话
   */
  async compressConversation(messages, options = {}) {
    return this.compress(messages, options);
  }

  async summarizeHistory(messages, options = {}) {
    if (messages.length === 0) return null;

    // 识别关键转折点
    const keyTurns = this.identifyKeyTurns(messages);

    // 提取核心信息
    const coreInfo = this.extractCoreInfo(messages, keyTurns);

    // 生成结构化摘要
    return this.generateSummary(coreInfo, options);
  }

  /**
   * 识别关键转折点
   */
  identifyKeyTurns(messages) {
    const keyTurns = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const content = String(msg.content || msg.text || '');

      // 新主题标志
      const isNewTopic = /^(关于|询问|请问|我想问|换个问题)/.test(content) ||
                         /^(now|next|about|regarding)/i.test(content);

      // 重要决策标志
      const isImportantDecision = /(确定|决定|选择|采用|最终|结论)/.test(content) ||
                                  /(confirm|decide|choose|final|conclusion)/i.test(content);

      // 包含引用的回答（说明是重要信息）
      const hasCitations = /\[\d+\]/.test(content);

      // 长回答（可能包含重要信息）
      const isLongAnswer = msg.role === 'assistant' && content.length > 500;

      if (isNewTopic || isImportantDecision || hasCitations || isLongAnswer) {
        keyTurns.push({
          index: i,
          message: msg,
          reasons: {
            newTopic: isNewTopic,
            decision: isImportantDecision,
            citations: hasCitations,
            longAnswer: isLongAnswer
          }
        });
      }
    }

    return keyTurns;
  }

  /**
   * 提取核心信息
   */
  extractCoreInfo(messages, keyTurns) {
    const topics = [];
    const decisions = [];
    const citations = [];
    let questionsCount = 0;

    for (const turn of keyTurns) {
      const content = String(turn.message.content || turn.message.text || '');

      // 提取主题
      if (turn.reasons.newTopic) {
        const topic = this.extractTopic(content);
        if (topic) topics.push(topic);
      }

      // 提取决策
      if (turn.reasons.decision) {
        const decision = this.extractDecision(content);
        if (decision) decisions.push(decision);
      }

      // 提取引用
      if (turn.reasons.citations) {
        const citationNumbers = [...content.matchAll(/\[(\d+)\]/g)].map(m => m[1]);
        citations.push(...citationNumbers);
      }
    }

    // 统计问题数量
    questionsCount = messages.filter(m => m.role === 'user').length;

    return {
      questionsCount,
      topics: [...new Set(topics)],
      decisions: [...new Set(decisions)],
      citations: [...new Set(citations)],
      keyTurnsCount: keyTurns.length
    };
  }

  /**
   * 提取主题关键词
   */
  extractTopic(content) {
    // 简化版：提取前30个字作为主题
    const cleaned = content.replace(/^(关于|询问|请问|我想问|换个问题)[：:]?\s*/, '');
    return cleaned.slice(0, 30).trim();
  }

  /**
   * 提取决策内容
   */
  extractDecision(content) {
    // 提取包含决策关键词的句子
    const sentences = content.split(/[。！？.!?]/);
    for (const sentence of sentences) {
      if (/(确定|决定|选择|采用|最终|结论)/.test(sentence)) {
        return sentence.trim();
      }
    }
    return null;
  }

  /**
   * 生成结构化摘要
   */
  generateSummary(coreInfo, options = {}) {
    const parts = [];

    parts.push(`[对话历史摘要]`);
    parts.push(`共 ${coreInfo.questionsCount} 轮对话，识别 ${coreInfo.keyTurnsCount} 个关键节点。`);

    if (coreInfo.topics.length > 0) {
      const topicsStr = coreInfo.topics.slice(0, 3).join('、');
      parts.push(`讨论主题：${topicsStr}${coreInfo.topics.length > 3 ? '等' : ''}`);
    }

    if (coreInfo.decisions.length > 0) {
      parts.push(`重要结论：${coreInfo.decisions.slice(0, 2).join('；')}`);
    }

    if (coreInfo.citations.length > 0) {
      parts.push(`引用证据 [${coreInfo.citations.slice(0, 5).join('][')}]`);
    }

    return parts.join('\n');
  }

  /**
   * 自适应压缩：根据目标token数动态调整
   */
  async adaptiveCompress(messages, targetTokens) {
    const originalTokens = this.calculateTotalTokens(messages);

    if (originalTokens <= targetTokens) {
      return {
        compressed: messages,
        summary: null,
        stats: { original: originalTokens, compressed: originalTokens, saved: 0 }
      };
    }

    // 计算需要保留的最近消息数
    let preserveRecent = this.preserveRecent;
    let result = await this.compress(messages, { preserveRecent });

    // 如果还是太长，继续减少保留数量
    while (result.stats.compressed > targetTokens && preserveRecent > 1) {
      preserveRecent--;
      const tempService = new ContextCompressionService({ maxTokens: targetTokens, preserveRecent });
      result = await tempService.compress(messages);
    }

    return result;
  }

  /**
   * 批量压缩多个对话
   */
  async compressBatch(conversationsList) {
    const results = [];

    for (const conversation of conversationsList) {
      const result = await this.compress(conversation.messages);
      results.push({
        conversationId: conversation.id,
        ...result
      });
    }

    return results;
  }

  /**
   * 获取压缩统计报告
   */
  getCompressionReport(stats) {
    return {
      ...stats,
      efficiency: stats.saved > 0 ? `节省 ${stats.ratio}% (${stats.saved} tokens)` : '未压缩',
      recommendation: stats.compressed > this.maxTokens * 0.9
        ? '建议进一步压缩或结束当前对话'
        : stats.compressed > this.maxTokens * 0.7
          ? '上下文使用正常'
          : '上下文充足'
    };
  }
}

/**
 * 增量压缩：每次只压缩新增的部分
 */
export class IncrementalCompressor {
  constructor(compressionService) {
    this.compressionService = compressionService;
    this.cache = new Map(); // conversationId -> { lastProcessedIndex, summary }
  }

  /**
   * 增量压缩
   */
  async compressIncremental(conversationId, messages) {
    const cached = this.cache.get(conversationId);

    if (!cached) {
      // 首次压缩
      const result = await this.compressionService.compress(messages);
      this.cache.set(conversationId, {
        lastProcessedIndex: messages.length,
        summary: result.summary
      });
      return result;
    }

    // 只处理新增的消息
    const newMessages = messages.slice(cached.lastProcessedIndex);

    if (newMessages.length === 0) {
      // 没有新消息，返回缓存
      return {
        compressed: messages,
        summary: cached.summary,
        stats: { original: 0, compressed: 0, saved: 0 }
      };
    }

    // 合并旧摘要和新消息
    const combined = [
      ...(cached.summary ? [{ role: 'system', content: cached.summary }] : []),
      ...newMessages
    ];

    const result = await this.compressionService.compress(combined);

    // 更新缓存
    this.cache.set(conversationId, {
      lastProcessedIndex: messages.length,
      summary: result.summary
    });

    return result;
  }

  /**
   * 清理缓存
   */
  clearCache(conversationId) {
    if (conversationId) {
      this.cache.delete(conversationId);
    } else {
      this.cache.clear();
    }
  }
}
