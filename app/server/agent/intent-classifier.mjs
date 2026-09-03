/**
 * 意图识别层 - 快速分类用户意图
 * Intent Classifier: Knowledge/Writing/Analysis/Task/Chat
 */

export const INTENT_TYPES = Object.freeze({
  KNOWLEDGE_QUERY: 'knowledge_query',      // 查询知识库
  KNOWLEDGE_UPDATE: 'knowledge_update',    // 更新知识
  WRITING: 'writing',                      // 写作相关
  ANALYSIS: 'analysis',                    // 分析对比
  TASK: 'task',                           // 任务管理
  CHAT: 'chat',                           // 闲聊对话
  CLARIFICATION: 'clarification'          // 需要澄清
});

// 意图识别规则：快速模式匹配 + 上下文推理
const INTENT_PATTERNS = {
  [INTENT_TYPES.KNOWLEDGE_QUERY]: [
    /(?:什么是|介绍|解释|说明|查[询找]|了解|知道|告诉我)/u,
    /(?:有没有|是否有|包含|提到|记录)/u,
    /(?:历史|之前|以前|上次|最近).*(?:说|提|记)/u
  ],
  [INTENT_TYPES.KNOWLEDGE_UPDATE]: [
    /(?:记住|记录|保存|添加|新增|更新|修改|删除)/u,
    /(?:这个|这条|这篇).*(?:加入|放进|存入)/u
  ],
  [INTENT_TYPES.WRITING]: [
    /(?:写|创作|起草|撰写|编写|生成|改写|润色|优化)/u,
    /(?:文章|文档|报告|总结|摘要|方案|计划)/u,
    /(?:帮我.*写|给我.*写)/u
  ],
  [INTENT_TYPES.ANALYSIS]: [
    /(?:分析|对比|比较|评估|判断|区别)/u,
    /(?:为什么|怎么|如何|原因|差异|优劣)/u,
    /(?:有什么.*不同|哪个更好)/u
  ],
  [INTENT_TYPES.TASK]: [
    /(?:任务|待办|提醒|计划|安排|日程)/u,
    /(?:创建|添加|完成|标记|设置).*(?:任务|待办)/u
  ]
};

// 澄清需求的信号
const CLARIFICATION_SIGNALS = [
  /(?:^|\s)(?:什么|啥|哪个|谁|怎么|如何|为啥)(?:\s|$)/u,
  /[？?]$/u,
  /(?:不太.*懂|不.*明白|不.*清楚)/u
];

// 闲聊信号
const CHAT_SIGNALS = [
  /^(?:你好|hi|hello|嗨|早|晚上好|谢谢|再见|拜拜)/iu,
  /(?:怎么样|如何|还好吗)/u,
  /(?:^|\s)(?:呵呵|哈哈|嘿嘿|嗯|哦|好的|收到)(?:\s|$)/u
];

/**
 * 从消息中提取关键实体
 */
function extractEntities(message) {
  const text = String(message?.content || message || '').trim();
  
  // 提取文档引用
  const documentMentions = [];
  const docPattern = /《([^》]+)》/gu;
  let match;
  while ((match = docPattern.exec(text)) !== null) {
    documentMentions.push(match[1]);
  }
  
  // 提取时间引用
  const timeReferences = [];
  const timePattern = /(?:今天|昨天|明天|本周|上周|最近|之前|以前)/gu;
  while ((match = timePattern.exec(text)) !== null) {
    timeReferences.push(match[0]);
  }
  
  // 提取操作动词
  const actions = [];
  const actionPattern = /(?:查询|搜索|查找|写|创建|分析|对比|更新|修改|删除|添加)/gu;
  while ((match = actionPattern.exec(text)) !== null) {
    actions.push(match[0]);
  }
  
  return {
    documentMentions,
    timeReferences,
    actions,
    hasQuestionMark: /[？?]/u.test(text),
    length: text.length
  };
}

/**
 * 基于规则快速分类意图
 */
function classifyByPatterns(text) {
  // 优先级：澄清 > 闲聊 > 具体意图
  
  // 检查是否需要澄清
  for (const pattern of CLARIFICATION_SIGNALS) {
    if (pattern.test(text)) {
      // 但如果有明确的操作词，不算澄清
      if (!/(?:查询|搜索|查找|写|创建|分析|对比)/u.test(text)) {
        return { type: INTENT_TYPES.CLARIFICATION, confidence: 0.7 };
      }
    }
  }
  
  // 检查是否是闲聊
  if (text.length < 20) {
    for (const pattern of CHAT_SIGNALS) {
      if (pattern.test(text)) {
        return { type: INTENT_TYPES.CHAT, confidence: 0.9 };
      }
    }
  }
  
  // 匹配具体意图
  const scores = {};
  for (const [intentType, patterns] of Object.entries(INTENT_PATTERNS)) {
    scores[intentType] = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        scores[intentType]++;
      }
    }
  }
  
  // 找出最高分
  let maxScore = 0;
  let maxIntent = null;
  for (const [intentType, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxIntent = intentType;
    }
  }
  
  if (maxIntent && maxScore > 0) {
    return {
      type: maxIntent,
      confidence: Math.min(0.95, 0.6 + maxScore * 0.15)
    };
  }
  
  // 默认为知识查询
  return { type: INTENT_TYPES.KNOWLEDGE_QUERY, confidence: 0.5 };
}

/**
 * 结合上下文进行意图推理
 */
function inferWithContext(message, context = {}) {
  const text = String(message?.content || message || '').trim();
  const entities = extractEntities(text);
  const baseClassification = classifyByPatterns(text);
  
  // 上下文调整
  let confidence = baseClassification.confidence;
  let intentType = baseClassification.type;
  
  // 如果有文档引用，更可能是知识查询
  if (entities.documentMentions.length > 0) {
    if (baseClassification.type === INTENT_TYPES.KNOWLEDGE_QUERY) {
      confidence = Math.min(0.95, confidence + 0.15);
    }
  }
  
  // 如果有多个操作词，可能是复杂任务
  if (entities.actions.length >= 2) {
    if (baseClassification.type === INTENT_TYPES.TASK) {
      confidence = Math.min(0.95, confidence + 0.1);
    }
  }
  
  // 考虑上一轮对话
  if (context.previousIntent) {
    const prev = context.previousIntent;
    // 连续的同类意图，置信度提升
    if (prev === intentType && !entities.hasQuestionMark) {
      confidence = Math.min(0.98, confidence + 0.1);
    }
  }
  
  // 如果消息很短且没有明确操作词，可能是追问或确认
  if (text.length < 15 && entities.actions.length === 0 && context.previousIntent) {
    return {
      type: INTENT_TYPES.CLARIFICATION,
      confidence: 0.7,
      isFollowUp: true
    };
  }
  
  return {
    type: intentType,
    confidence,
    entities,
    isFollowUp: false
  };
}

/**
 * 主入口：识别用户意图
 */
export function classifyIntent(message, options = {}) {
  const {
    context = {},
    returnDetails = false
  } = options;
  
  const result = inferWithContext(message, context);
  
  if (!returnDetails) {
    return {
      type: result.type,
      confidence: result.confidence
    };
  }
  
  return result;
}

/**
 * 批量分类（用于历史对话分析）
 */
export function classifyIntentBatch(messages = [], options = {}) {
  const results = [];
  let previousIntent = null;
  
  for (const message of messages) {
    if (message.role !== 'user') continue;
    
    const result = classifyIntent(message, {
      ...options,
      context: { previousIntent }
    });
    
    results.push({
      message: message.content,
      intent: result.type,
      confidence: result.confidence
    });
    
    previousIntent = result.type;
  }
  
  return results;
}

/**
 * 获取意图的自然语言描述
 */
export function describeIntent(intentType) {
  const descriptions = {
    [INTENT_TYPES.KNOWLEDGE_QUERY]: '查询知识',
    [INTENT_TYPES.KNOWLEDGE_UPDATE]: '更新知识',
    [INTENT_TYPES.WRITING]: '写作创作',
    [INTENT_TYPES.ANALYSIS]: '分析对比',
    [INTENT_TYPES.TASK]: '任务管理',
    [INTENT_TYPES.CHAT]: '闲聊对话',
    [INTENT_TYPES.CLARIFICATION]: '需要澄清'
  };
  return descriptions[intentType] || '未知意图';
}
