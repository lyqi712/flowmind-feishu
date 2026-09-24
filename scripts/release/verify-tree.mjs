import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');

function trackedFiles() {
  const output = execFileSync('git', ['-C', projectRoot, 'ls-files', '-z'], { encoding: 'buffer' });
  return output.toString('utf8').split('\0').filter(Boolean);
}

const forbiddenPathPatterns = [
  /(^|\/)node_modules\//i,
  /(^|\/)dist\//i,
  /(^|\/)desktop\/out(?:-|\/|$)/i,
  /(^|\/)\.runtime(?:\/|$)/i,
  /(^|\/)\.tmp(?:\/|$)/i,
  /(^|\/)evidence(?:\/|$)/i,
  /(^|\/)(?:state\.json(?:\.|$)|.*\.(?:sqlite|sqlite3|db|key|enc))(?:$|\/)/i,
  /(^|\/).*\.log$/i,
  /(^|\/)(?:\.env|\.env\.local|\.env\.production)$/i
];

const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/
];

const violations = [];
for (const relativePath of trackedFiles()) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (forbiddenPathPatterns.some(pattern => pattern.test(normalized))) {
    violations.push({ type: 'forbidden-path', path: normalized });
    continue;
  }
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) {
    violations.push({ type: 'missing-tracked-file', path: normalized });
    continue;
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  if (secretPatterns.some(pattern => pattern.test(text))) {
    violations.push({ type: 'secret-pattern', path: normalized });
  }
}

const result = {
  ok: violations.length === 0,
  trackedFiles: trackedFiles().length,
  violations
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
