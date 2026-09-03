/**
 * 响应生成器 - 自然语言生成，避免模板化
 * Response Generator: Natural language generation without templates
 */

import { INTENT_TYPES } from './intent-classifier.mjs';

/**
 * 生成开场白（动态，避免固定套路）
 */
function generateOpening(context = {}) {
  const { intent, hasResults, isFollowUp } = context;
  
  // 如果是连续对话，大部分时候不需要开场
  if (isFollowUp && Math.random() > 0.3) {
    return '';
  }
  
  // 根据意图和结果动态生成
  if (intent === INTENT_TYPES.KNOWLEDGE_QUERY) {
    if (!hasResults) {
      const variants = [
        '没有找到相关内容',
        '知识库里暂时没有这方面的资料',
        '这个问题目前没有记录'
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
    
    // 有结果时，大部分时候直接给答案，偶尔加个引导
    if (Math.random() < 0.7) {
      return '';
    }
    
    const variants = [
      '找到了相关信息',
      '根据知识库的记录',
      '这里有一些参考'
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  if (intent === INTENT_TYPES.ANALYSIS) {
    // 分析时可以简单说明分析角度
    if (Math.random() < 0.5) {
      return '';
    }
    const variants = [
      '从几个方面来看',
      '分析一下',
      '对比来看'
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  // 其他情况默认不用开场
  return '';
}

/**
 * 组织内容结构（避免固定的"首先、其次、最后"）
 */
function organizeContent(points, context = {}) {
  if (!points || points.length === 0) {
    return '';
  }
  
  // 单个点：直接说
  if (points.length === 1) {
    return points[0];
  }
  
  // 2个点：用连接词
  if (points.length === 2) {
    const connectors = ['，而且', '。同时', '，另外'];
    const connector = connectors[Math.floor(Math.random() * connectors.length)];
    return points[0] + connector + points[1];
  }
  
  // 3个或以上：根据复杂度决定
  const totalLength = points.reduce((sum, p) => sum + p.length, 0);
  const avgLength = totalLength / points.length;
  
  // 如果每个点都很短，用连贯的叙述
  if (avgLength < 30) {
    const connectors = ['，', '，同时', '，而且', '。另外', '；'];
    let result = points[0];
    for (let i = 1; i < points.length; i++) {
      const connector = connectors[Math.floor(Math.random() * connectors.length)];
      result += connector + points[i];
    }
    return result;
  }
  
  // 如果每个点都比较长，用列表但避免"首先其次"
  const listMarkers = [
    ['第一点', '第二点', '第三点'],
    ['1.', '2.', '3.'],
    ['一是', '二是', '三是'],
    ['', '', ''] // 无标记，纯段落
  ];
  
  const markers = listMarkers[Math.floor(Math.random() * listMarkers.length)];
  
  return points.map((point, index) => {
    const marker = markers[Math.min(index, markers.length - 1)];
    return marker ? `${marker} ${point}` : point;
  }).join('\n\n');
}

/**
 * 生成引用标注
 */
function generateCitations(sources = []) {
  if (!sources || sources.length === 0) {
    return '';
  }
  
  // 根据来源数量决定引用方式
  if (sources.length === 1) {
    return `[1]`;
  }
  
  // 多个来源：根据上下文决定
  const citations = sources.map((_, index) => `[${index + 1}]`);
  
  // 如果来源很多，可以合并引用
  if (sources.length > 3) {
    return `[1-${sources.length}]`;
  }
  
  return citations.join('');
}

/**
 * 生成追问或引导（主动但不强制）
 */
function generateFollowUp(context = {}) {
  const { intent, hasMoreInfo, isComplete } = context;
  
  // 如果回答已经很完整，70%的时候不追问
  if (isComplete && Math.random() < 0.7) {
    return '';
  }
  
  // 如果有更多信息，可以提示
  if (hasMoreInfo) {
    const variants = [
      '如果需要更详细的内容，我可以继续展开',
      '这里只是概述，具体的细节可以进一步说明',
      '还想了解哪方面的详情？'
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  // 根据意图提供自然的引导
  if (intent === INTENT_TYPES.KNOWLEDGE_QUERY) {
    // 30%的时候提供相关引导
    if (Math.random() < 0.3) {
      const variants = [
        '还有其他问题吗？',
        '需要了解相关的内容吗？',
        ''
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
  }
  
  if (intent === INTENT_TYPES.ANALYSIS) {
    // 分析后可以引导下一步
    if (Math.random() < 0.4) {
      const variants = [
        '需要进一步对比吗？',
        '想了解具体的实施建议吗？',
        ''
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
  }
  
  return '';
}

/**
 * 生成澄清性问题
 */
function generateClarification(message, context = {}) {
  const content = String(message.content || message || '').trim();
  
  // 分析缺失的信息
  const missing = [];
  
  // 检查是否缺少具体对象
  if (/这个|那个|它|他们/u.test(content) && !context.recentTopics) {
    missing.push({
      type: 'reference',
      question: '你说的是哪个？'
    });
  }
  
  // 检查是否缺少操作目标
  if (/怎么|如何/u.test(content) && content.length < 20) {
    missing.push({
      type: 'action',
      question: '具体想要做什么？'
    });
  }
  
  // 检查是否缺少范围
  if (/所有|全部|都/u.test(content) && !context.scope) {
    missing.push({
      type: 'scope',
      question: '你是指哪个范围？'
    });
  }
  
  if (missing.length === 0) {
    return {
      needsClarification: false,
      question: null
    };
  }
  
  // 选择最重要的澄清点
  const primary = missing[0];
  
  return {
    needsClarification: true,
    question: primary.question,
    missingInfo: missing.map(m => m.type)
  };
}

/**
 * 主响应生成器
 */
export class ResponseGenerator {
  constructor(options = {}) {
    this.config = {
      naturalness: options.naturalness || 0.8, // 自然度：0-1，越高越口语化
      conciseness: options.conciseness || 0.7, // 简洁度：0-1，越高越精简
      ...options
    };
  }
  
  /**
   * 生成完整响应
   */
  generate(data, context = {}) {
    const {
      intent = INTENT_TYPES.KNOWLEDGE_QUERY,
      content = [],
      sources = [],
      isFollowUp = false,
      hasMoreInfo = false,
      isComplete = true
    } = data;
    
    const parts = [];
    
    // 1. 开场（可选）
    const opening = generateOpening({
      intent,
      hasResults: content.length > 0,
      isFollowUp
    });
    if (opening) {
      parts.push(opening);
    }
    
    // 2. 主要内容
    if (Array.isArray(content) && content.length > 0) {
      const organized = organizeContent(content, { intent });
      parts.push(organized);
      
      // 3. 引用（如果有来源）
      if (sources.length > 0) {
        // 引用会自然地嵌入在相关内容后面，这里不需要单独处理
        // 因为调用方应该已经在content中标注了 [1][2] 等
      }
    } else if (intent === INTENT_TYPES.CHAT) {
      // 闲聊时的简单回复
      const chatResponses = [
        '有什么可以帮你的吗？',
        '我在，请说',
        '好的'
      ];
      parts.push(chatResponses[Math.floor(Math.random() * chatResponses.length)]);
    } else {
      // 没有内容时
      parts.push('暂时没有找到相关信息。你可以换个方式问，或者告诉我更多细节。');
    }
    
    // 4. 追问或引导（可选）
    const followUp = generateFollowUp({
      intent,
      hasMoreInfo,
      isComplete
    });
    if (followUp) {
      parts.push(followUp);
    }
    
    // 组装最终响应
    let response = parts.filter(Boolean).join('\n\n');
    
    // 应用自然度调整
    if (this.config.naturalness > 0.5) {
      response = this._makeMoreNatural(response);
    }
    
    // 应用简洁度调整
    if (this.config.conciseness > 0.7) {
      response = this._makeConcise(response);
    }
    
    return response;
  }
  
  /**
   * 生成澄清响应
   */
  generateClarification(message, context = {}) {
    const result = generateClarification(message, context);
    
    if (!result.needsClarification) {
      return null;
    }
    
    // 自然地提出澄清问题
    const introVariants = [
      '',
      '不太确定你的意思，',
      '想确认一下，'
    ];
    
    const intro = introVariants[Math.floor(Math.random() * introVariants.length)];
    
    return {
      type: 'clarification',
      content: intro + result.question,
      missingInfo: result.missingInfo
    };
  }
  
  /**
   * 生成对比响应
   */
  generateComparison(comparison, context = {}) {
    const { similarities = [], differences = {} } = comparison;
    
    const parts = [];
    
    // 相似点
    if (similarities.length > 0) {
      const simText = similarities.slice(0, 3).join('、');
      parts.push(`相同点在于${simText}`);
    }
    
    // 差异点
    if (differences.onlyInFirst?.length > 0 || differences.onlyInSecond?.length > 0) {
      const diff1 = differences.onlyInFirst?.slice(0, 2).join('、');
      const diff2 = differences.onlyInSecond?.slice(0, 2).join('、');
      
      if (diff1 && diff2) {
        parts.push(`不同的是，前者有${diff1}，后者有${diff2}`);
      } else if (diff1) {
        parts.push(`主要区别是${diff1}`);
      } else if (diff2) {
        parts.push(`主要区别是${diff2}`);
      }
    }
    
    if (parts.length === 0) {
      return '从目前的信息来看，两者比较接近。';
    }
    
    return parts.join('。');
  }
  
  /**
   * 内部：让表达更自然
   */
  _makeMoreNatural(text) {
    let result = text;
    
    // 去掉过于正式的表达
    result = result.replace(/根据以上|综上所述|总而言之/gu, '');
    
    // 简化连接词
    result = result.replace(/首先，|其次，|最后，/gu, '');
    result = result.replace(/第一，|第二，|第三，/gu, '');
    
    // 去掉多余的礼貌用语
    result = result.replace(/希望.*能.*帮助.*到.*您/gu, '');
    
    return result.trim();
  }
  
  /**
   * 内部：让表达更简洁
   */
  _makeConcise(text) {
    let result = text;
    
    // 去掉冗余的修饰
    result = result.replace(/非常|十分|特别|尤其/gu, '');
    
    // 简化重复表达
    result = result.replace(/可以说是|可以认为|基本上/gu, '');
    
    // 合并多余的空行
    result = result.replace(/\n{3,}/gu, '\n\n');
    
    return result.trim();
  }
}

export {
  generateOpening,
  organizeContent,
  generateCitations,
  generateFollowUp,
  generateClarification
};
