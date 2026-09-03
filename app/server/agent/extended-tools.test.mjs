/**
 * Extended Tools Test Suite
 * 扩展工具集测试用例
 */

import { ToolRegistry } from './tool-registry.mjs';
import { registerExtendedTools } from './extended-tools.mjs';

// Mock 文档仓库
class MockContentRepository {
  constructor() {
    this.documents = new Map();
  }

  addDocument(doc) {
    this.documents.set(doc.id, doc);
  }

  getContentItem(id) {
    return this.documents.get(id) || null;
  }

  listIndexChunks(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc || !doc.chunks) return [];
    return doc.chunks;
  }
}

// 创建测试环境
function createTestEnvironment() {
  const mockRepo = new MockContentRepository();
  
  // 添加测试文档
  mockRepo.addDocument({
    id: 'doc-001',
    title: '产品需求文档 v1.0',
    content: `# 产品需求文档

## 背景
我们需要开发一个知识管理系统。该系统将帮助用户更好地组织和检索信息。

## 核心功能
- 文档管理
- 智能搜索
- 协作编辑

## 时间规划
2024年1月15日：项目启动
2024年2月1日：完成原型设计
2024年3月10日：第一版发布

## 关键指标
- 用户数：10000人
- 文档数：50000份
- 响应时间：<200ms`,
    revision: 1,
    contentHash: 'abc123',
    currentVersionId: 'v1'
  });

  mockRepo.addDocument({
    id: 'doc-002',
    title: '产品需求文档 v2.0',
    content: `# 产品需求文档

## 背景
我们需要开发一个智能知识管理系统。该系统将利用AI技术帮助用户更高效地组织、检索和创作内容。

## 核心功能
- 文档管理（增强版）
- AI智能搜索
- 协作编辑
- 智能问答
- 自动摘要

## 时间规划
2024年1月15日：项目启动
2024年2月15日：完成高保真原型
2024年3月10日：Alpha版本
2024年4月20日：正式发布

## 关键指标
- 用户数：50000人
- 文档数：200000份
- 响应时间：<150ms
- AI准确率：>95%`,
    revision: 2,
    contentHash: 'def456',
    currentVersionId: 'v2'
  });

  mockRepo.addDocument({
    id: 'doc-003',
    title: '用户反馈汇总',
    content: `# 用户反馈汇总

## 正面反馈
用户表示系统界面很好看，搜索功能很强大，使用体验excellent。

## 改进建议
- 需要改善移动端体验
- 希望增加更多协作功能
- 导出功能有问题

## 数据
- 满意度：85%
- 日活用户：3500人
- 平均使用时长：25分钟`,
    revision: 1,
    contentHash: 'ghi789',
    currentVersionId: 'v1'
  });

  const getDocuments = () => [...mockRepo.documents.values()];
  
  const registry = new ToolRegistry({
    getDocuments,
    contentRepository: mockRepo
  });

  registerExtendedTools(registry);

  return { registry, mockRepo, getDocuments };
}

// 测试辅助函数
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertExists(value, name) {
  assert(value !== null && value !== undefined, `${name} should exist`);
}

function assertEqual(actual, expected, name) {
  assert(actual === expected, `${name}: expected ${expected}, got ${actual}`);
}

function assertArrayLength(array, length, name) {
  assert(Array.isArray(array), `${name} should be an array`);
  assert(array.length === length, `${name} length: expected ${length}, got ${array.length}`);
}

// 测试套件
const tests = {
  async 'test_knowledge_compare_basic'() {
    console.log('测试: knowledge.compare - 基础对比');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('knowledge.compare', {
      documentId1: 'doc-001',
      documentId2: 'doc-002'
    }, {});

    assertExists(result.result, 'result');
    assertEqual(result.result.document1.id, 'doc-001', 'document1.id');
    assertEqual(result.result.document2.id, 'doc-002', 'document2.id');
    assertExists(result.result.comparison, 'comparison');
    assert(result.result.comparison.similarity >= 0 && result.result.comparison.similarity <= 100, 'similarity in range');
    assertExists(result.result.comparison.commonThemes, 'commonThemes');
    assertExists(result.result.sourceRefs, 'sourceRefs');
    
    console.log('  ✓ 相似度:', result.result.comparison.similarity + '%');
    console.log('  ✓ 共同主题:', result.result.comparison.commonThemes.slice(0, 3));
    console.log('  ✓ 通过');
  },

  async 'test_knowledge_compare_document_not_found'() {
    console.log('测试: knowledge.compare - 文档不存在');
    const { registry } = createTestEnvironment();

    try {
      await registry.execute('knowledge.compare', {
        documentId1: 'doc-001',
        documentId2: 'doc-999'
      }, {});
      throw new Error('Should have thrown error');
    } catch (error) {
      assertEqual(error.code, 'KNOWLEDGE_DOCUMENT_NOT_FOUND', 'error code');
      console.log('  ✓ 正确抛出错误');
    }
  },

  async 'test_knowledge_timeline_extraction'() {
    console.log('测试: knowledge.timeline - 时间线提取');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('knowledge.timeline', {
      documentId: 'doc-001'
    }, {});

    assertExists(result.result, 'result');
    assertEqual(result.result.documentId, 'doc-001', 'documentId');
    assertExists(result.result.timeline, 'timeline');
    assert(result.result.totalEvents > 0, 'should find events');
    
    console.log('  ✓ 提取到事件数:', result.result.totalEvents);
    console.log('  ✓ 第一个事件:', result.result.timeline[0]?.date);
    console.log('  ✓ 通过');
  },

  async 'test_writing_draft_article'() {
    console.log('测试: writing.draft - 文章大纲');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('writing.draft', {
      topic: 'AI在知识管理中的应用',
      type: 'article'
    }, {});

    assertExists(result.result, 'result');
    assertEqual(result.result.topic, 'AI在知识管理中的应用', 'topic');
    assertEqual(result.result.type, 'article', 'type');
    assertExists(result.result.structure, 'structure');
    assert(result.result.structure.outline.length > 0, 'should have sections');
    assertExists(result.result.writingTips, 'writingTips');
    
    console.log('  ✓ 章节数:', result.result.structure.outline.length);
    console.log('  ✓ 第一章:', result.result.structure.outline[0]?.title);
    console.log('  ✓ 通过');
  },

  async 'test_writing_draft_with_references'() {
    console.log('测试: writing.draft - 带参考文档');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('writing.draft', {
      topic: '产品分析报告',
      type: 'report',
      referenceDocumentIds: ['doc-001', 'doc-002']
    }, {});

    assertExists(result.result.references, 'references');
    assertEqual(result.result.references.totalReferences, 2, 'reference count');
    assertExists(result.result.sourceRefs, 'sourceRefs');
    assert(result.result.sourceRefs.length === 2, 'sourceRefs length');
    
    console.log('  ✓ 参考文档数:', result.result.references.totalReferences);
    console.log('  ✓ 通过');
  },

  async 'test_analyze_keywords_basic'() {
    console.log('测试: analyze.keywords - 关键词提取');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('analyze.keywords', {
      documentId: 'doc-001',
      limit: 10
    }, {});

    assertExists(result.result, 'result');
    assertExists(result.result.keywords, 'keywords');
    assert(result.result.keywords.length <= 10, 'keywords limit');
    assertExists(result.result.topThemes, 'topThemes');
    assertExists(result.result.statistics, 'statistics');
    
    console.log('  ✓ 关键词数:', result.result.keywords.length);
    console.log('  ✓ Top 3 主题:', result.result.topThemes.slice(0, 3));
    console.log('  ✓ 通过');
  },

  async 'test_analyze_keywords_with_sentiment'() {
    console.log('测试: analyze.keywords - 情感分析');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('analyze.keywords', {
      documentId: 'doc-003',
      limit: 15,
      includeSentiment: true
    }, {});

    assertExists(result.result.sentiment, 'sentiment');
    assert(['positive', 'negative', 'neutral'].includes(result.result.sentiment.sentiment), 'valid sentiment');
    assert(result.result.sentiment.score >= -1 && result.result.sentiment.score <= 1, 'score in range');
    
    console.log('  ✓ 情感:', result.result.sentiment.sentiment);
    console.log('  ✓ 得分:', result.result.sentiment.score);
    console.log('  ✓ 置信度:', result.result.sentiment.confidence + '%');
    console.log('  ✓ 通过');
  },

  async 'test_task_breakdown_basic'() {
    console.log('测试: task.breakdown - 任务拆解');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('task.breakdown', {
      description: `开发用户管理系统：
        实现用户注册功能
        实现用户登录功能
        添加权限控制
        编写单元测试
        部署到测试环境`
    }, {});

    assertExists(result.result, 'result');
    assertExists(result.result.breakdown, 'breakdown');
    assert(result.result.breakdown.subtasks.length > 0, 'should have subtasks');
    assertExists(result.result.breakdown.complexity, 'complexity');
    assertExists(result.result.suggestions, 'suggestions');
    
    console.log('  ✓ 子任务数:', result.result.breakdown.subtasks.length);
    console.log('  ✓ 复杂度:', result.result.breakdown.complexity);
    console.log('  ✓ 预估时间:', result.result.breakdown.totalEstimated);
    console.log('  ✓ 通过');
  },

  async 'test_task_breakdown_with_reference'() {
    console.log('测试: task.breakdown - 带参考文档');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('task.breakdown', {
      description: '实现智能搜索功能，包括全文检索、语义搜索和过滤排序',
      referenceDocumentId: 'doc-001'
    }, {});

    assertExists(result.result.breakdown, 'breakdown');
    assertExists(result.result.sourceRefs, 'sourceRefs');
    assert(result.result.sourceRefs.length > 0, 'should have sourceRefs');
    
    console.log('  ✓ 使用了参考文档');
    console.log('  ✓ 通过');
  },

  async 'test_knowledge_extract_basic'() {
    console.log('测试: knowledge.extract - 信息提取');
    const { registry } = createTestEnvironment();

    const result = await registry.execute('knowledge.extract', {
      documentId: 'doc-001'
    }, {});

    assertExists(result.result, 'result');
    assertExists(result.result.extracted, 'extracted');
    assertExists(result.result.extracted.bulletPoints, 'bulletPoints');
    assertExists(result.result.extracted.numberedPoints, 'numberedPoints');
    assertExists(result.result.extracted.keyNumbers, 'keyNumbers');
    
    console.log('  ✓ 列表项:', result.result.extracted.totalBullets);
    console.log('  ✓ 编号项:', result.result.extracted.totalNumbered);
    console.log('  ✓ 数值:', result.result.extracted.totalNumbers);
    console.log('  ✓ 通过');
  },

  async 'test_tool_argument_validation'() {
    console.log('测试: 参数验证');
    const { registry } = createTestEnvironment();

    // 缺少必填参数
    try {
      await registry.execute('knowledge.compare', {
        documentId1: 'doc-001'
        // 缺少 documentId2
      }, {});
      throw new Error('Should have thrown error');
    } catch (error) {
      assertEqual(error.code, 'TOOL_ARGUMENT_INVALID', 'error code');
      console.log('  ✓ 正确检测缺少必填参数');
    }

    // 参数类型错误
    try {
      await registry.execute('analyze.keywords', {
        documentId: 'doc-001',
        limit: 'not-a-number'
      }, {});
      throw new Error('Should have thrown error');
    } catch (error) {
      assertEqual(error.code, 'TOOL_ARGUMENT_INVALID', 'error code');
      console.log('  ✓ 正确检测参数类型错误');
    }

    console.log('  ✓ 通过');
  },

  async 'test_tool_list_extended'() {
    console.log('测试: 工具列表');
    const { registry } = createTestEnvironment();

    const tools = registry.list({ includeWrite: false });
    
    const extendedTools = tools.filter(t => 
      t.name.startsWith('knowledge.') && 
      ['knowledge.compare', 'knowledge.timeline', 'knowledge.extract'].includes(t.name)
    );

    assert(extendedTools.length >= 3, 'should have extended knowledge tools');
    
    const writingTools = tools.filter(t => t.name.startsWith('writing.'));
    assert(writingTools.length >= 1, 'should have writing tools');
    
    const analyzeTools = tools.filter(t => t.name.startsWith('analyze.'));
    assert(analyzeTools.length >= 1, 'should have analyze tools');
    
    const taskTools = tools.filter(t => t.name.startsWith('task.'));
    assert(taskTools.length >= 1, 'should have task tools');
    
    console.log('  ✓ 知识工具:', extendedTools.length);
    console.log('  ✓ 写作工具:', writingTools.length);
    console.log('  ✓ 分析工具:', analyzeTools.length);
    console.log('  ✓ 任务工具:', taskTools.length);
    console.log('  ✓ 通过');
  },

  async 'test_performance_keywords'() {
    console.log('测试: 性能 - 关键词提取');
    const { registry } = createTestEnvironment();

    const start = Date.now();
    await registry.execute('analyze.keywords', {
      documentId: 'doc-001',
      limit: 20
    }, {});
    const elapsed = Date.now() - start;

    assert(elapsed < 1000, 'should complete in < 1s');
    console.log('  ✓ 耗时:', elapsed + 'ms');
    console.log('  ✓ 通过');
  },

  async 'test_integration_workflow'() {
    console.log('测试: 集成工作流');
    const { registry } = createTestEnvironment();

    // 1. 分析文档关键词
    const keywords = await registry.execute('analyze.keywords', {
      documentId: 'doc-001',
      limit: 10
    }, {});
    assertExists(keywords.result, 'keywords result');

    // 2. 提取时间线
    const timeline = await registry.execute('knowledge.timeline', {
      documentId: 'doc-001'
    }, {});
    assertExists(timeline.result, 'timeline result');

    // 3. 生成写作大纲
    const draft = await registry.execute('writing.draft', {
      topic: '产品开发总结',
      type: 'report',
      referenceDocumentIds: ['doc-001']
    }, {});
    assertExists(draft.result, 'draft result');

    // 4. 拆解任务
    const breakdown = await registry.execute('task.breakdown', {
      description: '完成产品文档撰写，包括需求分析、架构设计和用户手册',
      referenceDocumentId: 'doc-001'
    }, {});
    assertExists(breakdown.result, 'breakdown result');

    console.log('  ✓ 完成4步工作流');
    console.log('  ✓ 通过');
  }
};

// 运行测试
async function runTests() {
  console.log('\n=================================');
  console.log('FlowMind 扩展工具集测试套件');
  console.log('=================================\n');

  let passed = 0;
  let failed = 0;

  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      passed++;
      console.log('');
    } catch (error) {
      failed++;
      console.error(`✗ 失败:`, error.message);
      console.error(error.stack);
      console.log('');
    }
  }

  console.log('=================================');
  console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('=================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// 导出用于外部调用
export { runTests, createTestEnvironment, tests };

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  runTests().catch(error => {
    console.error('测试运行失败:', error);
    process.exit(1);
  });
}
