/**
 * Agent 内核 - 整合所有模块
 * Agent Core: Integration of all modules
 */

import { classifyIntent, INTENT_TYPES } from './intent-classifier.mjs';
import { ReasoningEngine } from './reasoning-engine.mjs';
import { ToolOrchestrator } from './tool-orchestrator.mjs';
import { ConversationMemory } from './conversation-memory.mjs';
import { ResponseGenerator } from './response-generator.mjs';

/**
 * Agent 配置
 */
const DEFAULT_CONFIG = {
  // 记忆配置
  memory: {
    windowSize: 10,
    summaryThreshold: 20
  },
  
  // 推理配置
  reasoning: {
    maxDepth: 3,
    confidenceThreshold: 0.6
  },
  
  // 响应配置
  response: {
    naturalness: 0.8,
    conciseness: 0.7
  },
  
  // 工具配置
  tools: {
    adaptiveMode: true
  },
  
  // 意图识别配置
  intent: {
    returnDetails: true
  }
};

/**
 * Agent 核心类
 */
export class AgentCore {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    
    // 初始化各个模块
    this.memory = new ConversationMemory(this.config.memory);
    this.reasoningEngine = new ReasoningEngine();
    this.orchestrator = new ToolOrchestrator({
      adaptiveMode: this.config.tools.adaptiveMode
    });
    this.responseGenerator = new ResponseGenerator(this.config.response);
    
    // 上下文
    this.context = {
      documents: [],
      userPreferences: [],
      currentTopic: null
    };
    
    // 状态
    this.state = {
      isReady: true,
      lastIntent: null,
      conversationId: null
    };
  }
  
  /**
   * 设置知识库文档
   */
  setDocuments(documents) {
    this.context.documents = documents;
    this.reasoningEngine.setDocuments(documents);
  }
  
  /**
   * 设置用户偏好
   */
  setUserPreferences(preferences) {
    this.context.userPreferences = preferences;
  }
  
  /**
   * 处理用户消息（核心方法）
   */
  async processMessage(message, options = {}) {
    const startTime = Date.now();
    
    // 1. 添加到记忆
    const normalizedMessage = this.memory.addMessage({
      role: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    // 2. 获取上下文
    const conversationContext = this.memory.getContext({
      maxTokens: 4000,
      minRecent: 5
    });
    
    // 3. 识别意图
    const intent = classifyIntent(normalizedMessage, {
      context: {
        previousIntent: this.state.lastIntent,
        ...this.context
      },
      returnDetails: this.config.intent.returnDetails
    });
    
    this.state.lastIntent = intent.type;
    
    // 4. 检查是否需要澄清
    if (intent.type === INTENT_TYPES.CLARIFICATION) {
      const clarification = this.responseGenerator.generateClarification(
        normalizedMessage,
        {
          recentTopics: conversationContext.summary?.topics,
          scope: this.context.currentTopic
        }
      );
      
      if (clarification) {
        const response = {
          type: 'clarification',
          content: clarification.content,
          intent: intent,
          processingTime: Date.now() - startTime
        };
        
        this.memory.addMessage({
          role: 'assistant',
          content: clarification.content,
          timestamp: Date.now()
        });
        
        return response;
      }
    }
    
    // 5. 简单的闲聊直接回复
    if (intent.type === INTENT_TYPES.CHAT) {
      const chatResponse = this.responseGenerator.generate({
        intent: intent.type,
        content: [],
        isFollowUp: intent.isFollowUp
      });
      
      const response = {
        type: 'chat',
        content: chatResponse,
        intent: intent,
        processingTime: Date.now() - startTime
      };
      
      this.memory.addMessage({
        role: 'assistant',
        content: chatResponse,
        timestamp: Date.now()
      });
      
      return response;
    }
    
    // 6. 复杂任务：使用工具编排
    const orchestrationResult = await this.orchestrator.orchestrate(
      normalizedMessage,
      {
        intent,
        context: this.context
      }
    );
    
    // 7. 处理执行结果
    const executionResults = orchestrationResult.execution.steps || [];
    const hasErrors = executionResults.some(step => step.error);
    
    if (hasErrors) {
      // 处理错误
      const errorResponse = this._handleError(executionResults, intent);
      
      this.memory.addMessage({
        role: 'assistant',
        content: errorResponse.content,
        timestamp: Date.now()
      });
      
      return {
        ...errorResponse,
        intent,
        processingTime: Date.now() - startTime
      };
    }
    
    // 8. 生成响应内容
    const responseContent = await this._generateResponse(
      orchestrationResult,
      intent,
      conversationContext
    );
    
    // 9. 保存响应到记忆
    this.memory.addMessage({
      role: 'assistant',
      content: responseContent.content,
      timestamp: Date.now(),
      metadata: {
        intent: intent.type,
        confidence: intent.confidence,
        sources: responseContent.sources
      }
    });
    
    // 10. 返回完整响应
    return {
      ...responseContent,
      intent,
      reasoning: orchestrationResult.plan?.reasoning || [],
      processingTime: Date.now() - startTime,
      memoryStats: this.memory.getStats()
    };
  }
  
  /**
   * 流式处理消息（用于实时响应）
   */
  async *streamMessage(message, options = {}) {
    // 先进行意图识别和工具编排
    const normalizedMessage = this.memory.addMessage({
      role: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    const intent = classifyIntent(normalizedMessage, {
      context: { previousIntent: this.state.lastIntent }
    });
    
    // 发送意图识别结果
    yield {
      type: 'intent',
      data: intent
    };
    
    // 如果需要工具调用，发送计划
    if (intent.type !== INTENT_TYPES.CHAT && intent.type !== INTENT_TYPES.CLARIFICATION) {
      const plan = await this.orchestrator.orchestrate(normalizedMessage, {
        intent,
        context: this.context
      });
      
      yield {
        type: 'plan',
        data: plan.plan
      };
      
      // 发送执行进度
      for (const step of plan.execution.steps || []) {
        yield {
          type: 'step',
          data: step
        };
      }
    }
    
    // 生成响应内容（可以是流式的）
    const response = await this.processMessage(message, options);
    
    yield {
      type: 'response',
      data: response
    };
  }
  
  /**
   * 内部：生成响应
   */
  async _generateResponse(orchestrationResult, intent, conversationContext) {
    const executionSteps = orchestrationResult.execution.steps || [];
    const lastStep = executionSteps[executionSteps.length - 1];
    const result = lastStep?.result;
    
    // 根据意图类型处理结果
    switch (intent.type) {
      case INTENT_TYPES.KNOWLEDGE_QUERY: {
        // 搜索结果
        const documents = Array.isArray(result) ? result : [];
        const content = documents.map(doc => doc.excerpt || doc.content).filter(Boolean);
        
        const responseText = this.responseGenerator.generate({
          intent: intent.type,
          content,
          sources: documents,
          isFollowUp: intent.isFollowUp,
          hasMoreInfo: documents.length > 3,
          isComplete: documents.length > 0
        });
        
        return {
          type: 'knowledge_query',
          content: responseText,
          sources: documents,
          hasResults: documents.length > 0
        };
      }
      
      case INTENT_TYPES.ANALYSIS: {
        // 分析结果
        let analysisText = '';
        
        if (result?.claims || result?.evidence) {
          // 深度理解结果
          const claims = result.claims || [];
          const evidence = result.evidence || [];
          
          const content = [
            claims.length > 0 ? `主要观点：${claims.map(c => c.text).join('；')}` : '',
            evidence.length > 0 ? `支撑证据：${evidence.map(e => e.text).join('；')}` : ''
          ].filter(Boolean);
          
          analysisText = this.responseGenerator.generate({
            intent: intent.type,
            content,
            isComplete: true
          });
        } else if (result?.similarities || result?.differences) {
          // 对比结果
          analysisText = this.responseGenerator.generateComparison(result);
        } else {
          analysisText = '分析完成，但未找到显著结论。';
        }
        
        return {
          type: 'analysis',
          content: analysisText,
          analysisData: result
        };
      }
      
      case INTENT_TYPES.WRITING: {
        // 写作结果
        const fusedKnowledge = result;
        const content = [];
        
        if (fusedKnowledge?.concepts) {
          content.push(`关键概念：${fusedKnowledge.concepts.map(c => c.text).join('、')}`);
        }
        
        if (fusedKnowledge?.claims) {
          content.push(...fusedKnowledge.claims.map(c => c.text));
        }
        
        const responseText = this.responseGenerator.generate({
          intent: intent.type,
          content,
          isComplete: true
        });
        
        return {
          type: 'writing',
          content: responseText,
          writingData: fusedKnowledge
        };
      }
      
      default: {
        // 默认处理
        const responseText = this.responseGenerator.generate({
          intent: intent.type,
          content: result ? [String(result)] : [],
          isComplete: true
        });
        
        return {
          type: 'default',
          content: responseText
        };
      }
    }
  }
  
  /**
   * 内部：处理错误
   */
  _handleError(executionSteps, intent) {
    const errorStep = executionSteps.find(step => step.error);
    const errorMessage = errorStep?.error || '处理过程中出现了问题';
    
    // 生成友好的错误响应
    const content = `抱歉，${errorMessage}。你可以换个方式问，或者提供更多信息。`;
    
    return {
      type: 'error',
      content,
      error: errorMessage
    };
  }
  
  /**
   * 获取对话历史
   */
  getHistory(count = null) {
    return this.memory.getRecent(count);
  }
  
  /**
   * 搜索对话历史
   */
  searchHistory(query, options = {}) {
    return this.memory.search(query, options);
  }
  
  /**
   * 清空对话
   */
  clearConversation() {
    this.memory.clear();
    this.state.lastIntent = null;
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      memory: this.memory.getStats(),
      state: this.state,
      contextDocuments: this.context.documents.length
    };
  }
  
  /**
   * 导出会话（用于持久化）
   */
  export() {
    return {
      memory: this.memory.export(),
      context: this.context,
      state: this.state,
      config: this.config
    };
  }
  
  /**
   * 导入会话（从持久化恢复）
   */
  import(data) {
    if (!data) return;
    
    if (data.memory) {
      this.memory.import(data.memory);
    }
    
    if (data.context) {
      this.context = { ...this.context, ...data.context };
      if (data.context.documents) {
        this.setDocuments(data.context.documents);
      }
    }
    
    if (data.state) {
      this.state = { ...this.state, ...data.state };
    }
  }
}

export {
  INTENT_TYPES,
  DEFAULT_CONFIG
};
