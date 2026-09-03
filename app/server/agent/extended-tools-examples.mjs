/**
 * Extended Tools Integration Example
 * 扩展工具集成示例
 * 
 * 本文件展示如何在 FlowMind 项目中集成和使用扩展工具
 */

import { ToolRegistry } from './tool-registry.mjs';
import { registerExtendedTools } from './extended-tools.mjs';

/**
 * 场景1: 知识库深度分析
 * 对比不同版本的文档，识别变化
 */
async function scenario_compareVersions(registry) {
  console.log('\n=== 场景1: 版本对比分析 ===\n');

  // 对比两个版本的需求文档
  const comparison = await registry.execute('knowledge.compare', {
    documentId1: 'requirements-v1',
    documentId2: 'requirements-v2',
    focusAspect: '功能变更'
  }, {});

  const result = comparison.result;
  
  console.log(`文档1: ${result.document1.title} (${result.document1.length} 字符)`);
  console.log(`文档2: ${result.document2.title} (${result.document2.length} 字符)`);
  console.log(`\n相似度: ${result.comparison.similarity}%`);
  console.log(`\n共同主题:`);
  result.comparison.commonThemes.forEach(theme => console.log(`  - ${theme}`));
  console.log(`\n文档1独有内容:`);
  result.comparison.uniqueToDoc1.slice(0, 5).forEach(item => console.log(`  - ${item}`));
  console.log(`\n文档2新增内容:`);
  result.comparison.uniqueToDoc2.slice(0, 5).forEach(item => console.log(`  - ${item}`));

  return result;
}

/**
 * 场景2: 项目时间线梳理
 * 从会议纪要中提取项目关键节点
 */
async function scenario_projectTimeline(registry) {
  console.log('\n=== 场景2: 项目时间线梳理 ===\n');

  const timeline = await registry.execute('knowledge.timeline', {
    documentId: 'project-meetings',
    startDate: '2024-01-01',
    endDate: '2024-12-31'
  }, {});

  const result = timeline.result;
  
  console.log(`文档: ${result.title}`);
  console.log(`提取到 ${result.totalEvents} 个时间节点\n`);
  
  console.log('关键时间节点:');
  result.timeline.slice(0, 10).forEach(event => {
    console.log(`\n${event.date}`);
    console.log(`  ${event.context}`);
  });

  return result;
}

/**
 * 场景3: 内容创作辅助
 * 基于知识库生成写作大纲
 */
async function scenario_contentCreation(registry) {
  console.log('\n=== 场景3: 内容创作辅助 ===\n');

  // 先分析现有文档获取主题
  const keywords = await registry.execute('analyze.keywords', {
    documentId: 'market-research',
    limit: 10
  }, {});

  console.log('知识库主题分析:');
  keywords.result.topThemes.forEach(theme => console.log(`  - ${theme}`));

  // 基于分析生成写作大纲
  const draft = await registry.execute('writing.draft', {
    topic: 'AI驱动的知识管理创新',
    type: 'article',
    referenceDocumentIds: ['market-research', 'tech-trends']
  }, {});

  const result = draft.result;
  
  console.log(`\n文章标题: ${result.topic}`);
  console.log(`类型: ${result.type}`);
  console.log(`预估字数: ${result.structure.totalEstimatedWords}`);
  console.log(`\n文章结构:`);
  
  result.structure.outline.forEach(section => {
    console.log(`\n${section.order}. ${section.title}`);
    console.log(`   说明: ${section.content}`);
    console.log(`   建议字数: ${section.wordCount}`);
  });

  console.log(`\n写作建议:`);
  result.writingTips.forEach(tip => console.log(`  • ${tip}`));

  return result;
}

/**
 * 场景4: 用户反馈分析
 * 提取关键词和情感倾向
 */
async function scenario_feedbackAnalysis(registry) {
  console.log('\n=== 场景4: 用户反馈分析 ===\n');

  const analysis = await registry.execute('analyze.keywords', {
    documentId: 'user-feedback-q2',
    limit: 20,
    includeSentiment: true
  }, {});

  const result = analysis.result;
  
  console.log(`文档: ${result.title}`);
  console.log(`\n整体情感: ${result.sentiment.sentiment}`);
  console.log(`情感得分: ${result.sentiment.score} (置信度: ${result.sentiment.confidence}%)`);
  console.log(`正面词汇: ${result.sentiment.positiveCount} | 负面词汇: ${result.sentiment.negativeCount}`);
  
  console.log(`\nTop 10 关键词:`);
  result.keywords.slice(0, 10).forEach((kw, i) => {
    console.log(`  ${i + 1}. ${kw.word} (${kw.count}次)`);
  });

  console.log(`\n文档统计:`);
  console.log(`  总词数: ${result.statistics.totalWords}`);
  console.log(`  独特词数: ${result.statistics.uniqueWords}`);
  console.log(`  词汇丰富度: ${Math.round(result.statistics.uniqueWords / result.statistics.totalWords * 100)}%`);

  return result;
}

/**
 * 场景5: 项目任务规划
 * 将需求拆解为可执行的任务
 */
async function scenario_taskPlanning(registry) {
  console.log('\n=== 场景5: 项目任务规划 ===\n');

  const breakdown = await registry.execute('task.breakdown', {
    description: `
      开发AI知识问答功能：
      1. 设计RAG架构
      2. 实现文档索引和检索
      3. 集成大语言模型
      4. 优化答案生成质量
      5. 添加引用和溯源
      6. 进行性能优化
      7. 编写测试用例
      8. 部署到生产环境
    `,
    referenceDocumentId: 'tech-spec'
  }, {});

  const result = breakdown.result;
  
  console.log(`主要目标: ${result.breakdown.mainGoal}`);
  console.log(`复杂度: ${result.breakdown.complexity}`);
  console.log(`预估时间: ${result.breakdown.totalEstimated}`);
  
  console.log(`\n子任务清单:`);
  result.breakdown.subtasks.forEach(task => {
    console.log(`\n[${task.id}] ${task.title}`);
    console.log(`  优先级: ${task.priority}`);
    console.log(`  预估: ${task.estimated}`);
    if (task.dependencies.length > 0) {
      console.log(`  依赖: ${task.dependencies.join(', ')}`);
    }
  });

  console.log(`\n执行建议:`);
  result.suggestions.forEach(suggestion => console.log(`  • ${suggestion}`));

  return result;
}

/**
 * 场景6: 会议纪要整理
 * 从会议记录中提取结构化信息
 */
async function scenario_meetingNotes(registry) {
  console.log('\n=== 场景6: 会议纪要整理 ===\n');

  const extraction = await registry.execute('knowledge.extract', {
    documentId: 'meeting-2024-q2-planning',
    extractType: 'all'
  }, {});

  const result = extraction.result;
  
  console.log(`文档: ${result.title}`);
  
  if (result.extracted.bulletPoints.length > 0) {
    console.log(`\n讨论要点 (${result.extracted.totalBullets} 项):`);
    result.extracted.bulletPoints.slice(0, 8).forEach((point, i) => {
      console.log(`  ${i + 1}. ${point}`);
    });
  }

  if (result.extracted.numberedPoints.length > 0) {
    console.log(`\n行动项 (${result.extracted.totalNumbered} 项):`);
    result.extracted.numberedPoints.slice(0, 5).forEach((point, i) => {
      console.log(`  ${i + 1}. ${point}`);
    });
  }

  if (result.extracted.keyNumbers.length > 0) {
    console.log(`\n关键数据 (${result.extracted.totalNumbers} 项):`);
    result.extracted.keyNumbers.slice(0, 5).forEach(num => {
      console.log(`  • ${num.value}${num.unit}: ${num.context}`);
    });
  }

  return result;
}

/**
 * 场景7: 完整工作流 - 从需求到任务
 * 综合使用多个工具完成端到端流程
 */
async function scenario_endToEndWorkflow(registry) {
  console.log('\n=== 场景7: 完整工作流示例 ===\n');

  // 步骤1: 分析需求文档
  console.log('步骤1: 分析需求文档关键点...');
  const keywords = await registry.execute('analyze.keywords', {
    documentId: 'requirements-doc',
    limit: 15,
    includeSentiment: false
  }, {});
  console.log(`  提取了 ${keywords.result.keywords.length} 个关键词`);

  // 步骤2: 提取时间节点
  console.log('\n步骤2: 梳理项目时间线...');
  const timeline = await registry.execute('knowledge.timeline', {
    documentId: 'requirements-doc'
  }, {});
  console.log(`  识别了 ${timeline.result.totalEvents} 个时间节点`);

  // 步骤3: 生成实施方案大纲
  console.log('\n步骤3: 生成实施方案大纲...');
  const draft = await registry.execute('writing.draft', {
    topic: '项目实施方案',
    type: 'proposal',
    referenceDocumentIds: ['requirements-doc']
  }, {});
  console.log(`  生成了 ${draft.result.structure.outline.length} 个章节`);

  // 步骤4: 拆解执行任务
  console.log('\n步骤4: 拆解执行任务...');
  const firstSection = draft.result.structure.outline[0];
  const breakdown = await registry.execute('task.breakdown', {
    description: `${firstSection.title}: ${firstSection.content}`,
    referenceDocumentId: 'requirements-doc'
  }, {});
  console.log(`  生成了 ${breakdown.result.breakdown.subtasks.length} 个子任务`);

  console.log('\n工作流完成! 产出:');
  console.log(`  • 关键词分析报告`);
  console.log(`  • 项目时间线`);
  console.log(`  • 实施方案大纲 (${draft.result.structure.outline.length} 章节)`);
  console.log(`  • 任务清单 (${breakdown.result.breakdown.subtasks.length} 个任务)`);

  return {
    keywords: keywords.result,
    timeline: timeline.result,
    draft: draft.result,
    breakdown: breakdown.result
  };
}

/**
 * 主函数: 运行所有示例
 */
async function runExamples() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  FlowMind 扩展工具集成示例           ║');
  console.log('╚════════════════════════════════════════╝');

  // 创建并配置 ToolRegistry
  // 实际项目中，这些会从应用配置中获取
  const mockGetDocuments = () => []; // 实际项目中从 ContentRepository 获取
  const registry = new ToolRegistry({
    getDocuments: mockGetDocuments,
    contentRepository: null // 实际项目中传入真实的 repository
  });

  // 注册扩展工具
  registerExtendedTools(registry);

  console.log('\n已注册工具:');
  const tools = registry.list({ includeWrite: false });
  const extendedTools = tools.filter(t => 
    ['knowledge.compare', 'knowledge.timeline', 'writing.draft', 
     'analyze.keywords', 'task.breakdown', 'knowledge.extract'].includes(t.name)
  );
  extendedTools.forEach(tool => {
    console.log(`  ✓ ${tool.name} - ${tool.description.slice(0, 50)}...`);
  });

  // 在实际项目中，这里会调用真实的场景函数
  console.log('\n注意: 完整示例需要真实的文档数据');
  console.log('请参考 extended-tools.test.mjs 查看测试用例');
  
  // 示例调用方式（需要真实数据）:
  // await scenario_compareVersions(registry);
  // await scenario_projectTimeline(registry);
  // await scenario_contentCreation(registry);
  // await scenario_feedbackAnalysis(registry);
  // await scenario_taskPlanning(registry);
  // await scenario_meetingNotes(registry);
  // await scenario_endToEndWorkflow(registry);
}

/**
 * 快速开始指南
 */
function quickStartGuide() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║  快速开始                             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`
1. 导入模块:
   import { registerExtendedTools } from './extended-tools.mjs';
   import { ToolRegistry } from './tool-registry.mjs';

2. 注册工具:
   const registry = new ToolRegistry({ /* 配置 */ });
   registerExtendedTools(registry);

3. 使用工具:
   const result = await registry.execute('knowledge.compare', {
     documentId1: 'doc-1',
     documentId2: 'doc-2'
   }, context);

4. 查看可用工具:
   const tools = registry.list({ includeWrite: false });
   console.log(tools.map(t => t.name));

5. 运行测试:
   node app/server/agent/extended-tools.test.mjs

6. 查看文档:
   参见 app/server/agent/EXTENDED_TOOLS.md
  `);
}

// 导出场景函数供外部使用
export {
  scenario_compareVersions,
  scenario_projectTimeline,
  scenario_contentCreation,
  scenario_feedbackAnalysis,
  scenario_taskPlanning,
  scenario_meetingNotes,
  scenario_endToEndWorkflow,
  runExamples
};

// 直接运行时展示示例
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  runExamples()
    .then(() => quickStartGuide())
    .catch(error => {
      console.error('示例运行失败:', error);
      process.exit(1);
    });
}
