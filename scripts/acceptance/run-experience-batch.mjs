import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');

const SCRIPTS = [
  'comparison-answer-api-acceptance.mjs',
  'knowledge-graph-browser-acceptance.mjs',
  'graph-suggestion-deep-answer-browser-acceptance.mjs',
  'workspace-continuity-browser-acceptance.mjs',
  'parallel-conversations-browser-acceptance.mjs',
  'mobile-parallel-tabs-browser-acceptance.mjs',
  'mixed-tabs-stress-browser-acceptance.mjs',
  'cross-document-research-browser-acceptance.mjs',
  'home-ranking-browser-acceptance.mjs',
  'reader-workspace-handoff-browser-acceptance.mjs',
  'command-palette-browser-acceptance.mjs'
];

function runScript(name) {
  return new Promise((resolveRun, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(here, name)], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      resolveRun({ name, code, ms: Date.now() - started, stdout, stderr });
    });
  });
}

const results = [];
for (const name of SCRIPTS) {
  const result = await runScript(name);
  results.push(result);
  const ok = result.code === 0;
  process.stdout.write(`${ok ? '✓' : '✗'} ${name} (${result.ms}ms)\n`);
  if (!ok) {
    process.stderr.write(result.stderr || result.stdout || `${name} failed\n`);
    break;
  }
}

const summary = {
  ok: results.every(item => item.code === 0),
  total: results.length,
  planned: SCRIPTS.length,
  results: results.map(item => ({ name: item.name, ok: item.code === 0, ms: item.ms }))
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
