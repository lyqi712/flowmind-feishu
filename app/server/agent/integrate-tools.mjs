#!/usr/bin/env node
/**
 * 一键集成扩展工具到项目
 * 
 * 使用方法:
 *   node integrate-tools.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function info(msg) {
  console.log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`);
}

function success(msg) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

function error(msg) {
  console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
}

console.log('\n╔════════════════════════════════════════╗');
console.log('║  FlowMind 扩展工具集成助手           ║');
console.log('╚════════════════════════════════════════╝\n');

const registryPath = join(__dirname, 'tool-registry.mjs');

try {
  // 读取 tool-registry.mjs
  info('读取 tool-registry.mjs...');
  let content = readFileSync(registryPath, 'utf-8');

  // 检查是否已经集成
  if (content.includes('registerExtendedTools')) {
    warn('扩展工具已经集成，无需重复集成');
    console.log('\n提示: 如需重新集成，请先手动移除相关代码\n');
    process.exit(0);
  }

  // 检查导入语句位置
  const importMatch = content.match(/import.*from.*['"]\.\/evidence\.mjs['"];?\n/);
  if (!importMatch) {
    error('无法找到合适的导入位置');
    console.log('\n请手动添加以下代码到 tool-registry.mjs:\n');
    console.log('1. 在导入区域添加:');
    console.log('   import { registerExtendedTools } from \'./extended-tools.mjs\';');
    console.log('\n2. 在 createToolRegistry 函数中添加:');
    console.log('   registerExtendedTools(registry);');
    console.log();
    process.exit(1);
  }

  // 添加导入语句
  const importInsertPos = importMatch.index + importMatch[0].length;
  const importStatement = "import { registerExtendedTools } from './extended-tools.mjs';\n";
  
  content = content.slice(0, importInsertPos) + importStatement + content.slice(importInsertPos);
  success('添加导入语句');

  // 查找 createToolRegistry 函数
  const functionMatch = content.match(/export function createToolRegistry\([^)]*\)\s*\{/);
  if (!functionMatch) {
    error('无法找到 createToolRegistry 函数');
    process.exit(1);
  }

  // 查找 return registry 语句
  const returnMatch = content.match(/return registry;/);
  if (!returnMatch) {
    error('无法找到 return registry 语句');
    process.exit(1);
  }

  // 在 return 之前添加注册调用
  const registerCall = '\n  // 注册扩展工具\n  registerExtendedTools(registry);\n  ';
  const returnInsertPos = returnMatch.index;
  
  content = content.slice(0, returnInsertPos) + registerCall + content.slice(returnInsertPos);
  success('添加注册调用');

  // 备份原文件
  const backupPath = registryPath + '.backup';
  writeFileSync(backupPath, readFileSync(registryPath));
  success(`备份原文件到: ${backupPath}`);

  // 写入修改后的内容
  writeFileSync(registryPath, content);
  success('修改 tool-registry.mjs');

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  ✓ 集成完成！                        ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('下一步:');
  console.log('1. 运行测试验证: node extended-tools.test.mjs');
  console.log('2. 检查集成: node validate-integration.mjs');
  console.log('3. 重启应用查看效果');
  console.log('\n如需回滚，可恢复备份文件:\n');
  console.log(`   mv ${backupPath} ${registryPath}\n`);

} catch (err) {
  error('集成失败: ' + err.message);
  console.log('\n请手动集成，步骤见 INTEGRATION.md\n');
  process.exit(1);
}
