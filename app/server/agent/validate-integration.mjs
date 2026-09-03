#!/usr/bin/env node
/**
 * Extended Tools Integration Validator
 * 扩展工具集成验证脚本
 * 
 * 使用方法:
 *   node app/server/agent/validate-integration.mjs
 */

import { ToolRegistry } from './tool-registry.mjs';
import { registerExtendedTools, EXTENDED_TOOL_SCHEMAS } from './extended-tools.mjs';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function success(msg) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

function error(msg) {
  console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}

function info(msg) {
  console.log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
}

function section(title) {
  console.log(`\n${COLORS.cyan}━━━ ${title} ━━━${COLORS.reset}\n`);
}

// 验证项
const validations = {
  async checkToolRegistration() {
    section('1. 工具注册验证');
    
    const registry = new ToolRegistry({
      getDocuments: () => [],
      contentRepository: null
    });

    const toolsBefore = registry.list({ includeWrite: false }).length;
    info(`注册前工具数: ${toolsBefore}`);

    registerExtendedTools(registry);

    const toolsAfter = registry.list({ includeWrite: false }).length;
    info(`注册后工具数: ${toolsAfter}`);

    const extendedToolNames = [
      'knowledge.compare',
      'knowledge.timeline',
      'writing.draft',
      'analyze.keywords',
      'task.breakdown',
      'knowledge.extract'
    ];

    const allTools = registry.list({ includeWrite: false });
    const registeredExtended = allTools.filter(t => extendedToolNames.includes(t.name));

    if (registeredExtended.length === extendedToolNames.length) {
      success(`所有 ${extendedToolNames.length} 个扩展工具已注册`);
      registeredExtended.forEach(tool => {
        success(`  - ${tool.name}`);
      });
      return true;
    } else {
      error(`期望 ${extendedToolNames.length} 个工具，实际注册 ${registeredExtended.length} 个`);
      const missing = extendedToolNames.filter(name => 
        !registeredExtended.some(t => t.name === name)
      );
      if (missing.length > 0) {
        error('缺失工具:');
        missing.forEach(name => error(`  - ${name}`));
      }
      return false;
    }
  },

  async checkToolSchemas() {
    section('2. Schema 验证');

    const expectedSchemas = Object.keys(EXTENDED_TOOL_SCHEMAS);
    
    if (expectedSchemas.length === 6) {
      success(`Schema 定义完整 (${expectedSchemas.length} 个)`);
      expectedSchemas.forEach(name => {
        const schema = EXTENDED_TOOL_SCHEMAS[name];
        if (schema.type === 'object' && schema.required && schema.properties) {
          success(`  - ${name}: 结构正确`);
        } else {
          error(`  - ${name}: 结构不完整`);
        }
      });
      return true;
    } else {
      error(`期望 6 个 Schema，实际 ${expectedSchemas.length} 个`);
      return false;
    }
  },

  async checkToolEffects() {
    section('3. 工具效果类型验证');

    const registry = new ToolRegistry({
      getDocuments: () => [],
      contentRepository: null
    });
    registerExtendedTools(registry);

    const tools = registry.list({ includeWrite: false });
    const extendedTools = tools.filter(t => 
      ['knowledge.compare', 'knowledge.timeline', 'writing.draft',
       'analyze.keywords', 'task.breakdown', 'knowledge.extract'].includes(t.name)
    );

    let allRead = true;
    extendedTools.forEach(tool => {
      if (tool.effect === 'read') {
        success(`  - ${tool.name}: effect=read ✓`);
      } else {
        error(`  - ${tool.name}: effect=${tool.effect} (期望 read)`);
        allRead = false;
      }
    });

    return allRead;
  },

  async checkToolDescriptions() {
    section('4. 工具描述验证');

    const registry = new ToolRegistry({
      getDocuments: () => [],
      contentRepository: null
    });
    registerExtendedTools(registry);

    const tools = registry.list({ includeWrite: false });
    const extendedTools = tools.filter(t => 
      ['knowledge.compare', 'knowledge.timeline', 'writing.draft',
       'analyze.keywords', 'task.breakdown', 'knowledge.extract'].includes(t.name)
    );

    let allValid = true;
    extendedTools.forEach(tool => {
      if (tool.description && tool.description.length > 20) {
        success(`  - ${tool.name}: ${tool.description.slice(0, 50)}...`);
      } else {
        error(`  - ${tool.name}: 描述过短或缺失`);
        allValid = false;
      }
    });

    return allValid;
  },

  async checkToolAvailability() {
    section('5. 工具可用性验证');

    const registry = new ToolRegistry({
      getDocuments: () => [],
      contentRepository: {
        getContentItem: () => null,
        listIndexChunks: () => []
      }
    });
    registerExtendedTools(registry);

    const tools = registry.list({ includeWrite: false });
    const extendedTools = tools.filter(t => 
      ['knowledge.compare', 'knowledge.timeline', 'writing.draft',
       'analyze.keywords', 'task.breakdown', 'knowledge.extract'].includes(t.name)
    );

    let allAvailable = true;
    extendedTools.forEach(tool => {
      if (tool.available) {
        success(`  - ${tool.name}: 可用`);
      } else {
        warn(`  - ${tool.name}: 不可用 - ${tool.availabilityReason || '未知原因'}`);
        allAvailable = false;
      }
    });

    return allAvailable;
  },

  async checkArgumentValidation() {
    section('6. 参数验证测试');

    const registry = new ToolRegistry({
      getDocuments: () => [],
      contentRepository: {
        getContentItem: () => null,
        listIndexChunks: () => []
      }
    });
    registerExtendedTools(registry);

    const testCases = [
      {
        name: 'knowledge.compare - 缺少必填参数',
        tool: 'knowledge.compare',
        args: { documentId1: 'doc-1' },
        shouldFail: true
      },
      {
        name: 'analyze.keywords - 参数类型错误',
        tool: 'analyze.keywords',
        args: { documentId: 'doc-1', limit: 'not-a-number' },
        shouldFail: true
      },
      {
        name: 'task.breakdown - 描述过短',
        tool: 'task.breakdown',
        args: { description: 'short' },
        shouldFail: true
      }
    ];

    let passed = 0;
    for (const testCase of testCases) {
      try {
        await registry.execute(testCase.tool, testCase.args, {});
        if (testCase.shouldFail) {
          error(`  - ${testCase.name}: 应该失败但成功了`);
        } else {
          success(`  - ${testCase.name}: 通过`);
          passed++;
        }
      } catch (err) {
        if (testCase.shouldFail) {
          if (err.code === 'TOOL_ARGUMENT_INVALID' || err.code === 'KNOWLEDGE_DOCUMENT_NOT_FOUND') {
            success(`  - ${testCase.name}: 正确抛出错误 (${err.code})`);
            passed++;
          } else {
            error(`  - ${testCase.name}: 错误代码不对 (${err.code})`);
          }
        } else {
          error(`  - ${testCase.name}: 不应该失败 - ${err.message}`);
        }
      }
    }

    return passed === testCases.length;
  },

  async checkFileStructure() {
    section('7. 文件结构验证');
    
    const fs = await import('fs');
    const path = await import('path');
    
    const requiredFiles = [
      'extended-tools.mjs',
      'extended-tools.test.mjs',
      'extended-tools-examples.mjs',
      'EXTENDED_TOOLS.md',
      'INTEGRATION.md'
    ];

    const baseDir = path.dirname(new URL(import.meta.url).pathname);
    
    let allExist = true;
    for (const file of requiredFiles) {
      const filePath = path.join(baseDir, file);
      try {
        await fs.promises.access(filePath);
        success(`  - ${file}: 存在`);
      } catch {
        error(`  - ${file}: 不存在`);
        allExist = false;
      }
    }

    return allExist;
  },

  async performanceCheck() {
    section('8. 性能基准测试');

    const registry = new ToolRegistry({
      getDocuments: () => [{
        id: 'test-doc',
        title: 'Test Document',
        content: '测试内容 '.repeat(1000),
        revision: 1,
        contentHash: 'test',
        currentVersionId: 'v1'
      }],
      contentRepository: {
        getContentItem: (id) => id === 'test-doc' ? {
          id: 'test-doc',
          title: 'Test Document',
          content: '测试内容 '.repeat(1000)
        } : null,
        listIndexChunks: () => []
      }
    });
    registerExtendedTools(registry);

    const benchmarks = [
      {
        name: 'analyze.keywords',
        args: { documentId: 'test-doc', limit: 20 },
        maxTime: 500
      },
      {
        name: 'knowledge.timeline',
        args: { documentId: 'test-doc' },
        maxTime: 500
      },
      {
        name: 'knowledge.extract',
        args: { documentId: 'test-doc' },
        maxTime: 500
      }
    ];

    let allFast = true;
    for (const bench of benchmarks) {
      const start = Date.now();
      try {
        await registry.execute(bench.name, bench.args, {});
        const elapsed = Date.now() - start;
        
        if (elapsed < bench.maxTime) {
          success(`  - ${bench.name}: ${elapsed}ms (< ${bench.maxTime}ms)`);
        } else {
          warn(`  - ${bench.name}: ${elapsed}ms (> ${bench.maxTime}ms)`);
          allFast = false;
        }
      } catch (err) {
        error(`  - ${bench.name}: 执行失败 - ${err.message}`);
        allFast = false;
      }
    }

    return allFast;
  }
};

// 运行所有验证
async function runValidation() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   FlowMind 扩展工具集成验证                   ║');
  console.log('╚════════════════════════════════════════════════╝');

  const results = {};
  let totalPassed = 0;
  let totalTests = 0;

  for (const [name, validation] of Object.entries(validations)) {
    totalTests++;
    try {
      const passed = await validation();
      results[name] = passed;
      if (passed) totalPassed++;
    } catch (err) {
      error(`验证失败: ${name}`);
      console.error(err);
      results[name] = false;
    }
  }

  // 总结
  section('验证总结');
  
  console.log('验证项目:');
  for (const [name, passed] of Object.entries(results)) {
    if (passed) {
      success(`  ${name}`);
    } else {
      error(`  ${name}`);
    }
  }

  console.log(`\n结果: ${totalPassed}/${totalTests} 项通过\n`);

  if (totalPassed === totalTests) {
    console.log(`${COLORS.green}╔════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.green}║  ✓ 所有验证通过！集成成功！         ║${COLORS.reset}`);
    console.log(`${COLORS.green}╚════════════════════════════════════════╝${COLORS.reset}\n`);
    
    console.log('下一步:');
    console.log('1. 运行完整测试: node app/server/agent/extended-tools.test.mjs');
    console.log('2. 查看示例: node app/server/agent/extended-tools-examples.mjs');
    console.log('3. 阅读文档: app/server/agent/EXTENDED_TOOLS.md');
    console.log('4. 集成到项目: 参考 app/server/agent/INTEGRATION.md\n');
    
    return 0;
  } else {
    console.log(`${COLORS.red}╔════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.red}║  ✗ 部分验证失败，请检查错误        ║${COLORS.reset}`);
    console.log(`${COLORS.red}╚════════════════════════════════════════╝${COLORS.reset}\n`);
    return 1;
  }
}

// 执行验证
runValidation()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('\n验证脚本执行失败:', err);
    process.exit(1);
  });
