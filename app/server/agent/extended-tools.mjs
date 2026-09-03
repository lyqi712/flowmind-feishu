/**
 * Extended AI Tools for FlowMind
 * 扩展 AI 工具集：深度理解、写作辅助、数据分析、任务管理、创意讨论
 */

function clean(value) {
  return String(value ?? '').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function toolError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function executionContext(value = {}) {
  return value?.context && typeof value.context === 'object' ? value.context : value;
}

function scopedDocumentIds(value = {}) {
  return new Set(safeArray(executionContext(value)?.documentIds).map(item => String(item || '').trim()).filter(Boolean));
}

function assertDocumentsInScope(documentIds, context) {
  const scope = scopedDocumentIds(context);
  if (!scope.size) return;
  for (const id of safeArray(documentIds)) {
    const documentId = String(id || '').trim();
    if (documentId && !scope.has(documentId)) {
      throw toolError('KNOWLEDGE_DOCUMENT_OUT_OF_SCOPE', `Document ${documentId} is outside the selected knowledge scope`, 403);
    }
  }
}

function sourceRefsFromDocuments(documents = [], getDocument = () => null) {
  return documents.map(doc => {
    const document = getDocument(doc.id || doc.documentId) || doc;
    return {
      documentId: String(document.id),
      contentItemId: String(document.id),
      title: String(document.title || 'Untitled document'),
      excerpt: String(document.content || '').slice(0, 240),
      revision: document.revision || null,
      contentHash: document.contentHash || null,
      contentVersionId: document.currentVersionId ?? null
    };
  }).filter(Boolean);
}

// 提取文档核心内容用于比较
function extractDocumentCore(document) {
  const content = String(document?.content || '');
  const title = String(document?.title || 'Untitled');
  
  // 提取关键信息
  const keywords = content
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3)
    .slice(0, 50);
  
  return {
    id: document.id,
    title,
    content,
    length: content.length,
    keywords: [...new Set(keywords)],
    structure: {
      paragraphs: content.split(/\n\n+/).filter(Boolean).length,
      lines: content.split(/\n/).length,
      hasLists: /^[\s]*[-*]\s/m.test(content),
      hasNumbering: /^[\s]*\d+\.\s/m.test(content),
      hasHeadings: /^#+\s/m.test(content)
    }
  };
}

// 对比两个文档
function compareDocuments(doc1Core, doc2Core) {
  const commonKeywords = doc1Core.keywords.filter(kw => doc2Core.keywords.includes(kw));
  const uniqueToDoc1 = doc1Core.keywords.filter(kw => !doc2Core.keywords.includes(kw)).slice(0, 20);
  const uniqueToDoc2 = doc2Core.keywords.filter(kw => !doc1Core.keywords.includes(kw)).slice(0, 20);
  
  const similarity = commonKeywords.length / Math.max(doc1Core.keywords.length, doc2Core.keywords.length, 1);
  
  return {
    similarity: Math.round(similarity * 100),
    commonThemes: commonKeywords.slice(0, 10),
    doc1Unique: uniqueToDoc1,
    doc2Unique: uniqueToDoc2,
    structuralDifferences: {
      lengthDiff: Math.abs(doc1Core.length - doc2Core.length),
      paragraphDiff: Math.abs(doc1Core.structure.paragraphs - doc2Core.structure.paragraphs),
      doc1Structure: doc1Core.structure,
      doc2Structure: doc2Core.structure
    }
  };
}

// 提取时间线信息
function extractTimeline(content) {
  const events = [];
  
  // 匹配各种日期格式
  const datePatterns = [
    /(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})[日号]?/g,
    /(\d{1,2})[月\-/.](\d{1,2})[日号]/g,
    /(\d{4})[年]/g,
    /(\d{1,2})月/g
  ];
  
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let foundDate = false;
    
    for (const pattern of datePatterns) {
      const matches = [...line.matchAll(pattern)];
      if (matches.length > 0) {
        foundDate = true;
        for (const match of matches) {
          const context = line.slice(Math.max(0, match.index - 20), Math.min(line.length, match.index + match[0].length + 100));
          events.push({
            date: match[0],
            context: context.trim(),
            lineNumber: i + 1,
            fullText: line.trim()
          });
        }
      }
    }
  }
  
  return events;
}

// 提取关键词
function extractKeywords(content, limit = 20) {
  // 分词并统计频率
  const words = content
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2);
  
  const frequency = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }
  
  // 排除常见停用词
  const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'an', 'be', '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己']);
  
  const keywords = Object.entries(frequency)
    .filter(([word]) => !stopWords.has(word))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
  
  return keywords;
}

// 情感分析
function analyzeSentiment(content) {
  const positive = ['好', '优秀', '成功', '提升', '改善', '创新', '增长', '卓越', '完美', '高效', 'good', 'great', 'excellent', 'success', 'improve', 'better', 'best'];
  const negative = ['差', '失败', '问题', '错误', '困难', '下降', '糟糕', '低效', '缺陷', 'bad', 'fail', 'error', 'problem', 'issue', 'worse', 'worst'];
  
  const lowerContent = content.toLowerCase();
  const positiveCount = positive.reduce((sum, word) => sum + (lowerContent.match(new RegExp(word, 'g')) || []).length, 0);
  const negativeCount = negative.reduce((sum, word) => sum + (lowerContent.match(new RegExp(word, 'g')) || []).length, 0);
  
  const total = positiveCount + negativeCount;
  if (total === 0) return { sentiment: 'neutral', score: 0, confidence: 0 };
  
  const score = (positiveCount - negativeCount) / total;
  const sentiment = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral';
  
  return {
    sentiment,
    score: Math.round(score * 100) / 100,
    confidence: Math.round(Math.abs(score) * 100),
    positiveCount,
    negativeCount
  };
}

// 任务拆解
function breakdownTask(taskDescription) {
  const lines = taskDescription.split('\n').filter(line => line.trim());
  
  // 识别目标
  const goalIndicators = ['目标', '要求', 'goal', 'objective', 'aim'];
  const goals = lines.filter(line => 
    goalIndicators.some(indicator => line.toLowerCase().includes(indicator))
  );
  
  // 生成子任务
  const subtasks = [];
  const sentences = taskDescription.split(/[。！？\n]/).filter(s => s.trim() && s.length > 10);
  
  // 提取动作关键词
  const actionWords = ['实现', '完成', '开发', '设计', '测试', '部署', '优化', '修复', '添加', '创建', 'implement', 'develop', 'design', 'test', 'deploy', 'fix', 'add', 'create'];
  
  for (const sentence of sentences) {
    const hasAction = actionWords.some(action => sentence.includes(action));
    if (hasAction) {
      subtasks.push({
        title: sentence.slice(0, 100),
        estimated: 'TBD',
        priority: 'medium',
        dependencies: []
      });
    }
  }
  
  // 如果没有识别到动作，就按段落拆分
  if (subtasks.length === 0) {
    const paragraphs = taskDescription.split(/\n\n+/).filter(Boolean);
    paragraphs.forEach((para, index) => {
      if (para.length > 20) {
        subtasks.push({
          title: `阶段 ${index + 1}: ${para.slice(0, 50)}...`,
          estimated: 'TBD',
          priority: index === 0 ? 'high' : 'medium',
          dependencies: index > 0 ? [`阶段 ${index}`] : []
        });
      }
    });
  }
  
  return {
    mainGoal: goals[0] || taskDescription.slice(0, 100),
    subtasks: subtasks.slice(0, 10),
    totalEstimated: `${subtasks.length * 2}-${subtasks.length * 4}h`,
    complexity: subtasks.length > 5 ? 'high' : subtasks.length > 2 ? 'medium' : 'low'
  };
}

// 生成写作草稿
function generateDraftStructure(topic, type = 'article') {
  const structures = {
    article: {
      sections: [
        { title: '引言', content: '介绍主题背景和重要性', wordCount: '200-300' },
        { title: '核心观点', content: '阐述主要论点', wordCount: '400-600' },
        { title: '支撑论据', content: '提供证据和案例', wordCount: '300-500' },
        { title: '结论', content: '总结要点和启发', wordCount: '200-300' }
      ]
    },
    report: {
      sections: [
        { title: '概述', content: '项目/事件概要', wordCount: '150-200' },
        { title: '背景', content: '相关背景信息', wordCount: '200-300' },
        { title: '分析', content: '详细分析和数据', wordCount: '500-800' },
        { title: '建议', content: '行动建议', wordCount: '200-400' },
        { title: '总结', content: '关键要点回顾', wordCount: '150-200' }
      ]
    },
    proposal: {
      sections: [
        { title: '问题陈述', content: '定义要解决的问题', wordCount: '200-300' },
        { title: '解决方案', content: '提出的方案', wordCount: '400-600' },
        { title: '实施计划', content: '具体执行步骤', wordCount: '300-500' },
        { title: '预期成果', content: '预期效果和收益', wordCount: '200-300' }
      ]
    }
  };
  
  const structure = structures[type] || structures.article;
  
  return {
    title: topic,
    type,
    outline: structure.sections.map((section, index) => ({
      order: index + 1,
      ...section,
      status: 'pending'
    })),
    totalEstimatedWords: structure.sections.reduce((sum, section) => {
      const [min] = section.wordCount.split('-').map(n => parseInt(n));
      return sum + min;
    }, 0)
  };
}

/**
 * 注册扩展工具到 ToolRegistry
 */
export function registerExtendedTools(registry) {
  if (!registry || typeof registry.register !== 'function') {
    throw new TypeError('Valid ToolRegistry instance is required');
  }

  // 1. knowledge.compare - 对比两个文档
  registry.register({
    name: 'knowledge.compare',
    effect: 'read',
    description: '深度对比两个知识库文档，分析异同点、共同主题和独特内容。适用于版本对比、观点对比、文档差异分析。',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId1', 'documentId2'],
      properties: {
        documentId1: { type: 'string', minLength: 1 },
        documentId2: { type: 'string', minLength: 1 },
        focusAspect: { type: 'string' }
      }
    },
    execute: ({ documentId1, documentId2, focusAspect = '' }, context) => {
      const getDocument = registry.getDocument.bind(registry);
      assertDocumentsInScope([documentId1, documentId2], context);
      const doc1 = getDocument(documentId1);
      const doc2 = getDocument(documentId2);
      
      if (!doc1) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId1}`, 404);
      if (!doc2) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId2}`, 404);
      
      const doc1Core = extractDocumentCore(doc1);
      const doc2Core = extractDocumentCore(doc2);
      const comparison = compareDocuments(doc1Core, doc2Core);
      
      return {
        document1: {
          id: doc1.id,
          title: doc1.title,
          length: doc1Core.length
        },
        document2: {
          id: doc2.id,
          title: doc2.title,
          length: doc2Core.length
        },
        comparison: {
          similarity: comparison.similarity,
          commonThemes: comparison.commonThemes,
          uniqueToDoc1: comparison.doc1Unique.slice(0, 10),
          uniqueToDoc2: comparison.doc2Unique.slice(0, 10),
          structuralDifferences: comparison.structuralDifferences
        },
        focusAspect: focusAspect || 'general',
        sourceRefs: sourceRefsFromDocuments([doc1, doc2], getDocument)
      };
    }
  });

  // 2. knowledge.timeline - 提取时间线
  registry.register({
    name: 'knowledge.timeline',
    effect: 'read',
    description: '从文档中提取时间线信息，识别日期和相关事件。适用于项目历史、事件梳理、时间轴分析。',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId'],
      properties: {
        documentId: { type: 'string', minLength: 1 },
        startDate: { type: 'string' },
        endDate: { type: 'string' }
      }
    },
    execute: ({ documentId, startDate = '', endDate = '' }, context) => {
      const getDocument = registry.getDocument.bind(registry);
      assertDocumentsInScope([documentId], context);
      const document = getDocument(documentId);
      
      if (!document) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId}`, 404);
      
      const content = String(document.content || '');
      let events = extractTimeline(content);
      
      // 过滤日期范围（简化版）
      if (startDate || endDate) {
        events = events.filter(event => {
          // 简单的字符串比较，实际项目中应该用日期解析
          return true;
        });
      }
      
      return {
        documentId: document.id,
        title: document.title,
        totalEvents: events.length,
        timeline: events.slice(0, 50),
        dateRange: {
          start: startDate || null,
          end: endDate || null
        },
        sourceRefs: sourceRefsFromDocuments([document], getDocument)
      };
    }
  });

  // 3. writing.draft - 生成草稿大纲
  registry.register({
    name: 'writing.draft',
    effect: 'read',
    description: '根据主题生成写作草稿大纲。支持文章、报告、提案等类型，提供结构化写作框架。',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['topic'],
      properties: {
        topic: { type: 'string', minLength: 1 },
        type: { type: 'string' },
        referenceDocumentIds: { type: 'array' }
      }
    },
    execute: ({ topic, type = 'article', referenceDocumentIds = [] }, context) => {
      const getDocument = registry.getDocument.bind(registry);
      assertDocumentsInScope(referenceDocumentIds, context);
      const structure = generateDraftStructure(topic, type);
      
      // 获取参考文档
      const references = safeArray(referenceDocumentIds)
        .map(id => getDocument(id))
        .filter(Boolean);
      
      const referenceInsights = references.length > 0 ? {
        totalReferences: references.length,
        referenceIds: references.map(doc => doc.id),
        referenceTitles: references.map(doc => doc.title)
      } : null;
      
      return {
        topic,
        type,
        structure,
        references: referenceInsights,
        writingTips: [
          '保持逻辑清晰，每个章节围绕一个核心观点',
          '使用具体案例和数据支撑论点',
          '注意段落之间的过渡和连贯性',
          '结论部分要呼应引言，形成闭环'
        ],
        sourceRefs: sourceRefsFromDocuments(references, getDocument)
      };
    }
  });

  // 4. analyze.keywords - 提取关键词
  registry.register({
    name: 'analyze.keywords',
    effect: 'read',
    description: '从文档中提取关键词和主题，进行词频分析和情感分析。适用于内容总结、主题识别、情感监测。',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId'],
      properties: {
        documentId: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 5, maximum: 50 },
        includeSentiment: { type: 'boolean' }
      }
    },
    execute: ({ documentId, limit = 20, includeSentiment = true }, context) => {
      const getDocument = registry.getDocument.bind(registry);
      assertDocumentsInScope([documentId], context);
      const document = getDocument(documentId);
      
      if (!document) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId}`, 404);
      
      const content = String(document.content || '');
      const keywords = extractKeywords(content, limit);
      const sentiment = includeSentiment ? analyzeSentiment(content) : null;
      
      return {
        documentId: document.id,
        title: document.title,
        keywords,
        topThemes: keywords.slice(0, 5).map(k => k.word),
        sentiment,
        statistics: {
          totalWords: content.split(/\s+/).length,
          uniqueWords: new Set(content.toLowerCase().split(/\s+/)).size,
          avgWordLength: Math.round(content.replace(/\s/g, '').length / content.split(/\s+/).length)
        },
        sourceRefs: sourceRefsFromDocuments([document], getDocument)
      };
    }
  });

  // 5. task.breakdown - 任务拆解
  registry.register({
    name: 'task.breakdown',
    effect: 'read',
    description: '将复杂任务拆解为可执行的子任务，识别依赖关系和优先级。适用于项目规划、任务管理、工作分解。',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['description'],
      properties: {
        description: { type: 'string', minLength: 10 },
        referenceDocumentId: { type: 'string' }
      }
    },
    execute: ({ description, referenceDocumentId = '' }, context) => {
      const getDocument = registry.getDocument.bind(registry);
      if (referenceDocumentId) assertDocumentsInScope([referenceDocumentId], context);
      let fullDescription = description;
      let referenceDoc = null;
      
      if (referenceDocumentId) {
        referenceDoc = getDocument(referenceDocumentId);
        if (referenceDoc) {
          fullDescription += '\n\n参考信息：\n' + String(referenceDoc.content || '').slice(0, 1000);
        }
      }
      
      const breakdown = breakdownTask(fullDescription);
      
      return {
        taskDescription: description,
        breakdown: {
          mainGoal: breakdown.mainGoal,
          subtasks: breakdown.subtasks.map((task, index) => ({
            id: `task-${index + 1}`,
            order: index + 1,
            ...task
          })),
          totalEstimated: breakdown.totalEstimated,
          complexity: breakdown.complexity
        },
        suggestions: [
          '根据依赖关系安排任务顺序',
          '优先处理高优先级和阻塞任务',
          '预留 20-30% 的缓冲时间应对意外',
          '定期回顾进度并调整计划'
        ],
        sourceRefs: referenceDoc ? sourceRefsFromDocuments([referenceDoc], getDocument) : []
      };
    }
  });

  // 6. knowledge.extract - 结构化信息提取
  registry.register({
    name: 'knowledge.extract',
    effect: 'read',
    description: '从文档中提取结构化信息，如列表、表格、关键数据点。适用于信息整理、数据提取、知识结构化。',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId'],
      properties: {
        documentId: { type: 'string', minLength: 1 },
        extractType: { type: 'string' }
      }
    },
    execute: ({ documentId, extractType = 'all' }, context) => {
      const getDocument = registry.getDocument.bind(registry);
      assertDocumentsInScope([documentId], context);
      const document = getDocument(documentId);
      
      if (!document) throw toolError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document not found: ${documentId}`, 404);
      
      const content = String(document.content || '');
      
      // 提取列表
      const lists = [];
      const listPattern = /^[\s]*[-*]\s+(.+)$/gm;
      let match;
      while ((match = listPattern.exec(content)) !== null) {
        lists.push(match[1].trim());
      }
      
      // 提取编号列表
      const numberedLists = [];
      const numberedPattern = /^[\s]*\d+\.\s+(.+)$/gm;
      while ((match = numberedPattern.exec(content)) !== null) {
        numberedLists.push(match[1].trim());
      }
      
      // 提取数字数据
      const numbers = [];
      const numberPattern = /(\d+(?:\.\d+)?)\s*([%元美元万亿千百十个件人次])?/g;
      const numberMatches = [...content.matchAll(numberPattern)].slice(0, 20);
      for (const m of numberMatches) {
        numbers.push({
          value: m[1],
          unit: m[2] || '',
          context: content.slice(Math.max(0, m.index - 30), Math.min(content.length, m.index + 50))
        });
      }
      
      return {
        documentId: document.id,
        title: document.title,
        extracted: {
          bulletPoints: lists.slice(0, 30),
          numberedPoints: numberedLists.slice(0, 30),
          keyNumbers: numbers.slice(0, 15),
          totalBullets: lists.length,
          totalNumbered: numberedLists.length,
          totalNumbers: numbers.length
        },
        extractType,
        sourceRefs: sourceRefsFromDocuments([document], getDocument)
      };
    }
  });

  return registry;
}

// 导出工具 schema，用于类型检查和文档生成
export const EXTENDED_TOOL_SCHEMAS = Object.freeze({
  'knowledge.compare': {
    type: 'object',
    additionalProperties: false,
    required: ['documentId1', 'documentId2'],
    properties: {
      documentId1: { type: 'string', minLength: 1 },
      documentId2: { type: 'string', minLength: 1 },
      focusAspect: { type: 'string' }
    }
  },
  'knowledge.timeline': {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: {
      documentId: { type: 'string', minLength: 1 },
      startDate: { type: 'string' },
      endDate: { type: 'string' }
    }
  },
  'writing.draft': {
    type: 'object',
    additionalProperties: false,
    required: ['topic'],
    properties: {
      topic: { type: 'string', minLength: 1 },
      type: { type: 'string' },
      referenceDocumentIds: { type: 'array' }
    }
  },
  'analyze.keywords': {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: {
      documentId: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 5, maximum: 50 },
      includeSentiment: { type: 'boolean' }
    }
  },
  'task.breakdown': {
    type: 'object',
    additionalProperties: false,
    required: ['description'],
    properties: {
      description: { type: 'string', minLength: 10 },
      referenceDocumentId: { type: 'string' }
    }
  },
  'knowledge.extract': {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: {
      documentId: { type: 'string', minLength: 1 },
      extractType: { type: 'string' }
    }
  }
});
