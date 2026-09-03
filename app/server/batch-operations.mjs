/**
 * 批量操作服务
 *
 * 高效处理大量文档、引用、反馈的批量操作：
 * 1. 批量文档导入和处理
 * 2. 批量引用验证
 * 3. 批量反馈分析
 * 4. 并发控制和进度追踪
 */

export class BatchOperationService {
  constructor({ concurrency = 5, timeout = 30000 } = {}) {
    this.concurrency = concurrency; // 最大并发数
    this.timeout = timeout;
    this.operations = new Map(); // operationId -> operation state
  }

  /**
   * 创建批量操作
   */
  createOperation(type, items, options = {}) {
    const operationId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const operation = {
      id: operationId,
      type,
      total: items.length,
      completed: 0,
      failed: 0,
      success: 0,
      status: 'pending',
      items: items.map((item, index) => ({
        index,
        item,
        status: 'pending',
        result: null,
        error: null,
        startTime: null,
        endTime: null
      })),
      startTime: Date.now(),
      endTime: null,
      options
    };

    this.operations.set(operationId, operation);
    return operationId;
  }

  /**
   * 执行批量操作
   */
  async execute(operationId, processFn) {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    operation.status = 'running';

    try {
      await this.processInBatches(operation, processFn);
      operation.status = 'completed';
    } catch (error) {
      operation.status = 'failed';
      operation.error = String(error?.message || error);
    } finally {
      operation.endTime = Date.now();
    }

    return this.getOperationStatus(operationId);
  }

  /**
   * 分批处理项目
   */
  async processInBatches(operation, processFn) {
    const pending = operation.items.filter(item => item.status === 'pending');

    for (let i = 0; i < pending.length; i += this.concurrency) {
      const batch = pending.slice(i, i + this.concurrency);

      await Promise.all(
        batch.map(item => this.processItem(operation, item, processFn))
      );
    }
  }

  /**
   * 处理单个项目
   */
  async processItem(operation, item, processFn) {
    item.status = 'processing';
    item.startTime = Date.now();

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
      );

      const result = await Promise.race([
        processFn(item.item, item.index, operation.options),
        timeoutPromise
      ]);

      item.status = 'success';
      item.result = result;
      operation.success++;
    } catch (error) {
      item.status = 'failed';
      item.error = String(error?.message || error);
      operation.failed++;
    } finally {
      item.endTime = Date.now();
      operation.completed++;
    }
  }

  /**
   * 获取操作状态
   */
  getOperationStatus(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) return null;

    const progress = operation.total > 0
      ? Math.round((operation.completed / operation.total) * 100)
      : 0;

    const duration = operation.endTime
      ? operation.endTime - operation.startTime
      : Date.now() - operation.startTime;

    return {
      id: operation.id,
      type: operation.type,
      status: operation.status,
      progress,
      total: operation.total,
      completed: operation.completed,
      success: operation.success,
      failed: operation.failed,
      duration,
      error: operation.error || null
    };
  }

  /**
   * 获取操作详细结果
   */
  getOperationResults(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) return null;

    return {
      ...this.getOperationStatus(operationId),
      items: operation.items.map(item => ({
        index: item.index,
        status: item.status,
        result: item.result,
        error: item.error,
        duration: item.endTime && item.startTime
          ? item.endTime - item.startTime
          : null
      }))
    };
  }

  /**
   * 取消操作
   */
  cancelOperation(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'running') {
      return false;
    }

    operation.status = 'cancelled';
    operation.endTime = Date.now();

    // 标记未处理的项目为已取消
    operation.items.forEach(item => {
      if (item.status === 'pending' || item.status === 'processing') {
        item.status = 'cancelled';
      }
    });

    return true;
  }

  /**
   * 清理已完成的操作
   */
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, operation] of this.operations.entries()) {
      if (operation.endTime && now - operation.endTime > maxAge) {
        this.operations.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 批量文档导入
   */
  async batchImportDocuments(documents, contentRepository) {
    const operationId = this.createOperation('import-documents', documents);

    const processFn = async (doc, index) => {
      // 验证文档格式
      if (!doc.title || !doc.content) {
        throw new Error('Missing required fields: title or content');
      }

      // 导入文档
      const result = await contentRepository.create({
        title: String(doc.title).trim(),
        content: String(doc.content),
        metadata: doc.metadata || {},
        knowledgeBaseId: doc.knowledgeBaseId
      });

      return {
        id: result.id,
        title: result.title,
        imported: true
      };
    };

    return await this.execute(operationId, processFn);
  }

  /**
   * 批量引用验证
   */
  async batchValidateCitations(messages, contentRepository) {
    const operationId = this.createOperation('validate-citations', messages);

    const processFn = async (message, index) => {
      const text = String(message.text || message.content || '');
      const citations = message.citations || [];

      // 提取引用编号
      const citationNumbers = [...text.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1]));

      // 检查引用有效性
      const invalidCitations = citationNumbers.filter(n => n > citations.length || n < 1);
      const missingCitations = citationNumbers.filter(n => {
        const citation = citations[n - 1];
        return !citation || !citation.documentId;
      });

      // 检查文档是否存在
      const validCitations = [];
      for (const num of citationNumbers) {
        const citation = citations[num - 1];
        if (citation && citation.documentId) {
          try {
            const doc = await contentRepository.findById(citation.documentId);
            if (doc) {
              validCitations.push(num);
            }
          } catch (error) {
            // 文档不存在或无权限
          }
        }
      }

      return {
        messageId: message.id,
        totalCitations: citationNumbers.length,
        validCitations: validCitations.length,
        invalidCitations: invalidCitations.length,
        missingCitations: missingCitations.length,
        quality: citationNumbers.length > 0
          ? Math.round((validCitations.length / citationNumbers.length) * 100)
          : 0
      };
    };

    return await this.execute(operationId, processFn);
  }

  /**
   * 批量反馈分析
   */
  async batchAnalyzeFeedback(feedbackList) {
    const operationId = this.createOperation('analyze-feedback', feedbackList);

    const processFn = async (feedback, index) => {
      const comment = String(feedback.comment || '').toLowerCase();

      // 关键词分析
      const keywords = {
        accuracy: /(准确|正确|错误|不对)/g,
        citation: /(引用|来源|出处)/g,
        completeness: /(完整|详细|简略|不足)/g,
        clarity: /(清楚|明白|模糊|混乱)/g,
        speed: /(快|慢|延迟|超时)/g
      };

      const analysis = {};
      for (const [category, pattern] of Object.entries(keywords)) {
        const matches = comment.match(pattern);
        analysis[category] = matches ? matches.length : 0;
      }

      // 情感倾向（简化版）
      const positiveWords = /(好|棒|赞|优秀|满意|喜欢)/g;
      const negativeWords = /(差|烂|糟|失望|不满|讨厌)/g;

      const positiveCount = (comment.match(positiveWords) || []).length;
      const negativeCount = (comment.match(negativeWords) || []).length;

      const sentiment = positiveCount > negativeCount ? 'positive'
        : negativeCount > positiveCount ? 'negative'
        : 'neutral';

      return {
        feedbackId: feedback.id,
        rating: feedback.rating,
        issueType: feedback.issueType,
        sentiment,
        keywords: analysis,
        commentLength: comment.length,
        hasComment: comment.length > 0
      };
    };

    return await this.execute(operationId, processFn);
  }

  /**
   * 批量更新文档元数据
   */
  async batchUpdateMetadata(updates, contentRepository) {
    const operationId = this.createOperation('update-metadata', updates);

    const processFn = async (update, index) => {
      const { documentId, metadata } = update;

      if (!documentId) {
        throw new Error('Missing documentId');
      }

      const doc = await contentRepository.findById(documentId);
      if (!doc) {
        throw new Error(`Document ${documentId} not found`);
      }

      const updated = await contentRepository.update(documentId, {
        metadata: { ...doc.metadata, ...metadata }
      });

      return {
        documentId,
        updated: true,
        metadataKeys: Object.keys(metadata)
      };
    };

    return await this.execute(operationId, processFn);
  }

  /**
   * 批量删除文档
   */
  async batchDeleteDocuments(documentIds, contentRepository) {
    const operationId = this.createOperation('delete-documents', documentIds);

    const processFn = async (documentId, index) => {
      if (!documentId) {
        throw new Error('Missing documentId');
      }

      await contentRepository.delete(documentId);

      return {
        documentId,
        deleted: true
      };
    };

    return await this.execute(operationId, processFn);
  }

  /**
   * 获取所有操作的摘要
   */
  getOperationsSummary() {
    const operations = Array.from(this.operations.values());

    const summary = {
      total: operations.length,
      running: operations.filter(op => op.status === 'running').length,
      completed: operations.filter(op => op.status === 'completed').length,
      failed: operations.filter(op => op.status === 'failed').length,
      cancelled: operations.filter(op => op.status === 'cancelled').length
    };

    return {
      ...summary,
      operations: operations.map(op => ({
        id: op.id,
        type: op.type,
        status: op.status,
        progress: op.total > 0 ? Math.round((op.completed / op.total) * 100) : 0,
        total: op.total,
        completed: op.completed,
        success: op.success,
        failed: op.failed
      }))
    };
  }

  /**
   * 重试失败的项目
   */
  async retryFailed(operationId, processFn) {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    const failedItems = operation.items.filter(item => item.status === 'failed');

    if (failedItems.length === 0) {
      return { retried: 0, message: 'No failed items to retry' };
    }

    // 重置失败项目的状态
    failedItems.forEach(item => {
      item.status = 'pending';
      item.error = null;
      operation.failed--;
      operation.completed--;
    });

    operation.status = 'running';

    // 重新处理
    for (const item of failedItems) {
      await this.processItem(operation, item, processFn);
    }

    operation.status = 'completed';
    operation.endTime = Date.now();

    return {
      retried: failedItems.length,
      success: failedItems.filter(item => item.status === 'success').length,
      failed: failedItems.filter(item => item.status === 'failed').length
    };
  }
}
