import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const electronExe = process.argv[2];
if (!electronExe || !fs.existsSync(electronExe)) {
  throw new Error(`Electron executable not found: ${electronExe || '<missing>'}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..', '..', 'app');
const resultFile = path.join(os.tmpdir(), `flowmind-electron-smoke-${process.pid}.json`);
await fs.promises.rm(resultFile, { force: true });

const child = spawn(electronExe, [path.join(appRoot, 'desktop'), '--disable-gpu'], {
  cwd: appRoot,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    IMA_DESKTOP_SMOKE_TEST: '1',
    IMA_DESKTOP_SMOKE_RESULT_FILE: resultFile,
    NODE_ENV: 'production'
  }
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const outcome = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`Electron smoke timed out after 30 seconds.\n${stdout}\n${stderr}`));
  }, 30_000);
  timer.unref?.();
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('close', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal });
  });
});

try {
  if (outcome.code !== 0) {
    throw new Error(`Electron smoke exited with code ${outcome.code}, signal ${outcome.signal || 'none'}.\n${stdout}\n${stderr}`);
  }
  if (!fs.existsSync(resultFile)) {
    throw new Error(`Electron smoke result file missing.\n${stdout}\n${stderr}`);
  }
  const result = JSON.parse(await fs.promises.readFile(resultFile, 'utf8'));
  if (result.ok !== true || result.loaded !== true) throw new Error('Electron smoke result payload is invalid.');
  console.log(JSON.stringify({ ok: true, origin: result.origin, electronExitCode: outcome.code }));
} finally {
  await fs.promises.rm(resultFile, { force: true });
}
