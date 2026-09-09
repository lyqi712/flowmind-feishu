import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const parallelScript = join(here, 'parallel-conversations-browser-acceptance.mjs');

const child = spawn(process.execPath, [parallelScript], {
  cwd: projectRoot,
  env: { ...process.env, FLOWMIND_MOBILE_PARALLEL: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });

const code = await new Promise(resolveExit => child.on('close', resolveExit));
if (code !== 0) {
  console.error(stderr || stdout);
  process.exit(code || 1);
}

const payload = JSON.parse(stdout.trim().split('\n').filter(line => line.startsWith('{')).pop());
assert.equal(payload.ok, true);
console.log(JSON.stringify({ ok: true, viewport: '390x844', inherited: payload }, null, 2));
