/**
 * 工具编排器 - Chain-of-Thought 多步骤推理
 * Tool Orchestrator: Multi-step reasoning and tool execution
 */

import { classifyIntent, INTENT_TYPES } from './intent-classifier.mjs';
import { ReasoningEngine } from './reasoning-engine.mjs';

/**
 * 工具定义
 */
const AVAILABLE_TOOLS = {
  search_knowledge: {
    name: 'search_knowledge',
    description: '在知识库中搜索相关文档',
    parameters: ['query', 'limit'],
    execute: async (params, context) => {
      // 实际执行知识库搜索
      return context.knowledgeSearch?.(params.query, params.limit) || [];
    }
  },
  
  create_document: {
    name: 'create_document',
    description: '创建新文档',
    parameters: ['title', 'content', 'tags'],
    execute: async (params, context) => {
      return context.createDocument?.(params) || { id: 'new-doc', created: true };
    }
  },
  
  update_document: {
    name: 'update_document',
    description: '更新已有文档',
    parameters: ['documentId', 'updates'],
    execute: async (params, context) => {
      return context.updateDocument?.(params.documentId, params.updates) || { updated: true };
    }
  },
  
  analyze_document: {
    name: 'analyze_document',
    description: '分析文档内容',
    parameters: ['documentId', 'analysisType'],
    execute: async (params, context) => {
      const engine = new ReasoningEngine({ documents: context.documents || [] });
      const doc = context.getDocument?.(params.documentId);
      if (!doc) return { error: 'Document not found' };
      return engine.understand(doc.content);
    }
  },
  
  compare_documents: {
    name: 'compare_documents',
    description: '对比两个文档',
    parameters: ['documentId1', 'documentId2'],
    execute: async (params, context) => {
      const engine = new ReasoningEngine({ documents: context.documents || [] });
      const doc1 = context.getDocument?.(params.documentId1);
      const doc2 = context.getDocument?.(params.documentId2);
      if (!doc1 || !doc2) return { error: 'Document not found' };
      return engine.compare(doc1, doc2);
    }
  },
  
  detect_contradictions: {
    name: 'detect_contradictions',
    description: '检测多个陈述之间的矛盾',
    parameters: ['statements'],
    execute: async (params, context) => {
      const engine = new ReasoningEngine({ documents: context.documents || [] });
      return engine.detectConflicts(params.statements);
    }
  }
};

/**
 * 规划工具调用链
 */
function planToolChain(intent, message, context = {}) {
  const plan = {
    steps: [],
    reasoning: []
  };
  
  switch (intent.type) {
    case INTENT_TYPES.KNOWLEDGE_QUERY: {
      // 1. 搜索知识库
      plan.steps.push({
        tool: 'search_knowledge',
        params: {
          query: message.content || message,
          limit: 5
        },
        reason: '在知识库中查找相关信息'
      });
      
      // 2. 如果用户问的是对比性问题，需要额外分析
      if (/对比|比较|区别/u.test(message.content || message)) {
        plan.steps.push({
          tool: 'analyze_results',
          params: { analysisType: 'comparison' },
          reason: '对搜索结果进行对比分析',
          dependsOn: [0]
        });
      }
      break;
    }
    
    case INTENT_TYPES.KNOWLEDGE_UPDATE: {
      // 1. 先搜索是否已存在
      plan.steps.push({
        tool: 'search_knowledge',
        params: {
          query: message.content || message,
          limit: 1
        },
        reason: '检查是否已有相关文档'
      });
      
      // 2. 根据结果决定创建还是更新
      plan.steps.push({
        tool: 'create_or_update',
        params: {},
        reason: '创建或更新文档',
        dependsOn: [0],
        conditional: true
      });
      break;
    }
    
    case INTENT_TYPES.WRITING: {
      // 1. 搜索相关素材
      plan.steps.push({
        tool: 'search_knowledge',
        params: {
          query: message.content || message,
          limit: 10
        },
        reason: '收集写作素材'
      });
      
      // 2. 分析素材
      plan.steps.push({
        tool: 'fuse_knowledge',
        params: {},
        reason: '融合多个来源的信息',
        dependsOn: [0]
      });
      
      // 3. 生成内容
      plan.steps.push({
        tool: 'generate_content',
        params: {},
        reason: '基于素材生成内容',
        dependsOn: [1]
      });
      break;
    }
    
    case INTENT_TYPES.ANALYSIS: {
      // 1. 搜索待分析对象
      plan.steps.push({
        tool: 'search_knowledge',
        params: {
          query: message.content || message,
          limit: 5
        },
        reason: '找到待分析的对象'
      });
      
      // 2. 深度分析
      plan.steps.push({
        tool: 'analyze_document',
        params: { analysisType: 'deep' },
        reason: '进行深度分析',
        dependsOn: [0]
      });
      
      // 3. 检测矛盾（如果有多个来源）
      plan.steps.push({
        tool: 'detect_contradictions',
        params: {},
        reason: '检测信息中的矛盾',
        dependsOn: [1],
        optional: true
      });
      break;
    }
    
    case INTENT_TYPES.CHAT: {
      // 闲聊不需要工具调用
      plan.steps.push({
        tool: 'direct_reply',
        params: {},
        reason: '直接回复用户'
      });
      break;
    }
    
    case INTENT_TYPES.CLARIFICATION: {
      // 需要澄清，生成追问
      plan.steps.push({
        tool: 'generate_clarification',
        params: {},
        reason: '生成澄清性问题'
      });
      break;
    }
    
    default: {
      // 默认搜索
      plan.steps.push({
        tool: 'search_knowledge',
        params: {
          query: message.content || message,
          limit: 5
        },
        reason: '搜索相关信息'
      });
    }
  }
  
  // 记录推理过程
  plan.reasoning = plan.steps.map((step, index) => ({
    step: index + 1,
    action: step.tool,
    reason: step.reason
  }));
  
  return plan;
}

/**
 * 执行工具调用链
 */
async function executeToolChain(plan, context = {}) {
  const results = [];
  const stepData = new Map(); // 存储每步的结果
  
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    
    // 检查依赖
    if (step.dependsOn) {
      const allDependenciesMet = step.dependsOn.every(depIndex => {
        return stepData.has(depIndex) && !stepData.get(depIndex).error;
      });
      
      if (!allDependenciesMet) {
        if (step.optional) {
          results.push({
            step: i,
            skipped: true,
            reason: 'Dependencies not met'
          });
          continue;
        } else {
          results.push({
            step: i,
            error: 'Required dependencies not met'
          });
          break;
        }
      }
    }
    
    // 执行工具
    try {
      const tool = AVAILABLE_TOOLS[step.tool];
      
      if (!tool) {
        // 特殊处理一些内置动作
        if (step.tool === 'direct_reply') {
          results.push({
            step: i,
            action: 'direct_reply',
            result: { type: 'chat' }
          });
          stepData.set(i, { type: 'chat' });
          continue;
        }
        
        if (step.tool === 'generate_clarification') {
          results.push({
            step: i,
            action: 'generate_clarification',
            result: { type: 'clarification' }
          });
          stepData.set(i, { type: 'clarification' });
          continue;
        }
        
        if (step.tool === 'create_or_update') {
          // 根据上一步的搜索结果决定
          const searchResult = stepData.get(step.dependsOn[0]);
          const shouldCreate = !searchResult || searchResult.length === 0;
          
          const nextTool = shouldCreate ? 'create_document' : 'update_document';
          const actualTool = AVAILABLE_TOOLS[nextTool];
          
          if (actualTool) {
            const result = await actualTool.execute(step.params, context);
            results.push({
              step: i,
              action: nextTool,
              result
            });
            stepData.set(i, result);
          }
          continue;
        }
        
        results.push({
          step: i,
          error: `Unknown tool: ${step.tool}`
        });
        break;
      }
      
      // 准备参数（可能需要从之前的步骤获取）
      const params = { ...step.params };
      if (step.dependsOn && step.dependsOn.length > 0) {
        params._previousResults = step.dependsOn.map(idx => stepData.get(idx));
      }
      
      // 执行
      const result = await tool.execute(params, context);
      
      results.push({
        step: i,
        action: step.tool,
        params: step.params,
        result
      });
      
      stepData.set(i, result);
      
    } catch (error) {
      results.push({
        step: i,
        error: error.message || 'Execution failed'
      });
      
      if (!step.optional) {
        break; // 非可选步骤失败，终止
      }
    }
  }
  
  return {
    results,
    finalData: stepData.get(stepData.size - 1),
    success: results.every(r => !r.error)
  };
}

/**
 * 自适应执行：根据中间结果动态调整计划
 */
async function adaptiveExecute(intent, message, context = {}) {
  const initialPlan = planToolChain(intent, message, context);
  const execution = {
    steps: [],
    reasoning: [...initialPlan.reasoning],
    adaptations: []
  };
  
  for (let i = 0; i < initialPlan.steps.length; i++) {
    const step = initialPlan.steps[i];
    
    // 执行当前步骤
    const stepResult = await executeToolChain(
      { steps: [step], reasoning: [] },
      context
    );
    
    execution.steps.push(stepResult.results[0]);
    
    // 检查是否需要调整后续计划
    if (step.conditional && stepResult.finalData) {
      const result = stepResult.finalData;
      
      // 例如：如果搜索没有结果，可能需要换个搜索策略
      if (step.tool === 'search_knowledge' && (!result || result.length === 0)) {
        execution.adaptations.push({
          at: i,
          reason: '搜索无结果，尝试扩展查询',
          action: 'expand_query'
        });
        
        // 插入新步骤
        initialPlan.steps.splice(i + 1, 0, {
          tool: 'search_knowledge',
          params: {
            query: expandQuery(message.content || message),
            limit: 10
          },
          reason: '使用扩展查询重新搜索'
        });
      }
      
      // 如果分析发现矛盾，可能需要额外的验证步骤
      if (step.tool === 'detect_contradictions' && result.contradictions?.length > 0) {
        execution.adaptations.push({
          at: i,
          reason: '发现矛盾，需要人工确认',
          action: 'request_confirmation'
        });
      }
    }
  }
  
  return execution;
}

/**
 * 扩展查询（简化版）
 */
function expandQuery(query) {
  const text = String(query || '').trim();
  
  // 添加同义词、相关词
  const expansions = {
    '分析': ['研究', '探讨', '调查'],
    '对比': ['比较', '区别', '差异'],
    '优点': ['优势', '长处', '好处'],
    '缺点': ['劣势', '短处', '不足']
  };
  
  let expanded = text;
  for (const [word, synonyms] of Object.entries(expansions)) {
    if (text.includes(word)) {
      expanded += ' ' + synonyms.join(' ');
    }
  }
  
  return expanded;
}

/**
 * 主入口：工具编排器
 */
export class ToolOrchestrator {
  constructor(options = {}) {
    this.context = options.context || {};
    this.adaptiveMode = options.adaptiveMode !== false;
  }
  
  setContext(context) {
    this.context = { ...this.context, ...context };
  }
  
  async orchestrate(message, options = {}) {
    // 1. 识别意图
    const intent = classifyIntent(message, {
      context: this.context
    });
    
    // 2. 规划工具链
    const plan = planToolChain(intent, message, this.context);
    
    // 3. 执行
    const execution = this.adaptiveMode
      ? await adaptiveExecute(intent, message, this.context)
      : await executeToolChain(plan, this.context);
    
    return {
      intent,
      plan,
      execution,
      adaptiveMode: this.adaptiveMode
    };
  }
  
  async executePlan(plan) {
    return executeToolChain(plan, this.context);
  }
}

export {
  AVAILABLE_TOOLS,
  planToolChain,
  executeToolChain,
  adaptiveExecute
};
