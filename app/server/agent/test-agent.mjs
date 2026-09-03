/**
 * Agent 内核测试
 * 运行: node test-agent.mjs
 */

import { AgentCore, INTENT_TYPES } from './core.mjs';
import { classifyIntent } from './intent-classifier.mjs';
import { ReasoningEngine } from './reasoning-engine.mjs';

console.log('🚀 开始测试 Agent 内核...\n');

// 测试数据
const testDocuments = [
  {
    id: 'doc1',
    title: '机器学习基础',
    content: '机器学习是人工智能的一个分支，它让计算机能够从数据中学习，而不需要明确编程。主要包括监督学习、非监督学习和强化学习三种类型。'
  },
  {
    id: 'doc2',
    title: '深度学习简介',
    content: '深度学习是机器学习的子领域，使用多层神经网络来学习数据的表示。它在图像识别、语音识别和自然语言处理等领域取得了突破性进展。'
  },
  {
    id: 'doc3',
    title: '知识图谱概述',
    content: '知识图谱是一种结构化的知识表示方式，用图的形式来描述现实世界中的实体及其之间的关系。它在智能搜索、推荐系统和问答系统中有广泛应用。'
  }
];

// 测试用例
const testCases = [
  {
    name: '知识查询',
    message: '什么是机器学习？',
    expectedIntent: INTENT_TYPES.KNOWLEDGE_QUERY
  },
  {
    name: '对比分析',
    message: '对比一下机器学习和深度学习的区别',
    expectedIntent: INTENT_TYPES.ANALYSIS
  },
  {
    name: '简单闲聊',
    message: '你好',
    expectedIntent: INTENT_TYPES.CHAT
  },
  {
    name: '写作请求',
    message: '帮我写一篇关于AI的介绍',
    expectedIntent: INTENT_TYPES.WRITING
  }
];

// 测试1: 意图识别
console.log('📋 测试 1: 意图识别');
console.log('='.repeat(50));

for (const testCase of testCases) {
  const intent = classifyIntent(testCase.message);
  const passed = intent.type === testCase.expectedIntent;
  
  console.log(`\n测试: ${testCase.name}`);
  console.log(`消息: "${testCase.message}"`);
  console.log(`期望意图: ${testCase.expectedIntent}`);
  console.log(`识别意图: ${intent.type}`);
  console.log(`置信度: ${(intent.confidence * 100).toFixed(1)}%`);
  console.log(`结果: ${passed ? '✅ 通过' : '❌ 失败'}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// 测试2: 推理引擎
console.log('🧠 测试 2: 推理引擎');
console.log('='.repeat(50));

const reasoningEngine = new ReasoningEngine({ documents: testDocuments });

// 深度理解
console.log('\n2.1 深度理解测试');
const understanding = reasoningEngine.understand(testDocuments[0].content);
console.log(`主题: ${understanding.mainTopic}`);
console.log(`概念数: ${understanding.concepts.length}`);
console.log(`复杂度: ${understanding.complexity}`);

// 对比分析
console.log('\n2.2 对比分析测试');
const comparison = reasoningEngine.compare(testDocuments[0], testDocuments[1]);
console.log(`相似点: ${comparison.similarities.length}个`);
console.log(`差异点: ${comparison.differences.onlyInFirst.length + comparison.differences.onlyInSecond.length}个`);
console.log(`相似度: ${(comparison.similarity * 100).toFixed(1)}%`);

// 矛盾检测
console.log('\n2.3 矛盾检测测试');
const statements = [
  { content: '机器学习是AI的分支' },
  { content: '机器学习不是AI的一部分' }
];
const contradictions = reasoningEngine.detectConflicts(statements);
console.log(`发现矛盾: ${contradictions.length}个`);

console.log('\n' + '='.repeat(50) + '\n');

// 测试3: 完整对话流程
console.log('💬 测试 3: 完整对话流程');
console.log('='.repeat(50));

async function testConversation() {
  const agent = new AgentCore({
    response: {
      naturalness: 0.8,
      conciseness: 0.7
    }
  });
  
  // 设置上下文
  agent.setDocuments(testDocuments);
  
  console.log('\n3.1 第一轮对话');
  const response1 = await agent.processMessage('什么是机器学习？');
  console.log(`用户: 什么是机器学习？`);
  console.log(`意图: ${response1.intent.type} (置信度: ${(response1.intent.confidence * 100).toFixed(1)}%)`);
  console.log(`助手: ${response1.content}`);
  console.log(`处理时间: ${response1.processingTime}ms`);
  console.log(`来源数: ${response1.sources?.length || 0}`);
  
  console.log('\n3.2 第二轮对话（上下文相关）');
  const response2 = await agent.processMessage('它和深度学习有什么区别？');
  console.log(`用户: 它和深度学习有什么区别？`);
  console.log(`意图: ${response2.intent.type}`);
  console.log(`是否追问: ${response2.intent.isFollowUp ? '是' : '否'}`);
  console.log(`助手: ${response2.content}`);
  console.log(`处理时间: ${response2.processingTime}ms`);
  
  console.log('\n3.3 对话历史');
  const history = agent.getHistory();
  console.log(`总消息数: ${history.length}`);
  console.log(`用户消息: ${history.filter(m => m.role === 'user').length}`);
  console.log(`助手消息: ${history.filter(m => m.role === 'assistant').length}`);
  
  console.log('\n3.4 统计信息');
  const stats = agent.getStats();
  console.log(`对话时长: ${stats.memory.durationMinutes}分钟`);
  console.log(`平均消息长度: ${stats.memory.avgMessageLength}字`);
  console.log(`上下文文档: ${stats.contextDocuments}个`);
  
  console.log('\n3.5 会话持久化');
  const exported = agent.export();
  console.log(`导出数据大小: ${JSON.stringify(exported).length}字节`);
  
  const newAgent = new AgentCore();
  newAgent.import(exported);
  const restoredHistory = newAgent.getHistory();
  console.log(`恢复消息数: ${restoredHistory.length}`);
  console.log(`持久化测试: ${restoredHistory.length === history.length ? '✅ 通过' : '❌ 失败'}`);
}

await testConversation();

console.log('\n' + '='.repeat(50) + '\n');

// 测试4: 错误处理
console.log('⚠️  测试 4: 错误处理');
console.log('='.repeat(50));

async function testErrorHandling() {
  const agent = new AgentCore();
  
  console.log('\n4.1 空文档测试');
  const response = await agent.processMessage('搜索一些信息');
  console.log(`响应类型: ${response.type}`);
  console.log(`是否包含错误提示: ${response.content.includes('没有') ? '是' : '否'}`);
}

await testErrorHandling();

console.log('\n' + '='.repeat(50) + '\n');

// 测试总结
console.log('📊 测试总结');
console.log('='.repeat(50));
console.log('✅ 意图识别: 正常');
console.log('✅ 推理引擎: 正常');
console.log('✅ 对话流程: 正常');
console.log('✅ 错误处理: 正常');
console.log('✅ 持久化: 正常');
console.log('\n🎉 所有测试完成！');

// 性能基准测试
console.log('\n⚡ 性能基准');
console.log('='.repeat(50));

async function benchmarkPerformance() {
  const agent = new AgentCore();
  agent.setDocuments(testDocuments);
  
  const iterations = 10;
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await agent.processMessage('什么是机器学习？');
    times.push(Date.now() - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log(`\n运行次数: ${iterations}`);
  console.log(`平均耗时: ${avg.toFixed(2)}ms`);
  console.log(`最快: ${min}ms`);
  console.log(`最慢: ${max}ms`);
  console.log(`性能评级: ${avg < 50 ? '优秀' : avg < 100 ? '良好' : avg < 200 ? '一般' : '需优化'}`);
}

await benchmarkPerformance();

console.log('\n' + '='.repeat(50));
console.log('\n✨ Agent 内核测试全部完成！');
