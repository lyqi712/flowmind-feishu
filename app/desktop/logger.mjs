import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /((?:api[_-]?key|app[_-]?secret|access[_-]?token|tenant[_-]?token|password)\s*[:=]\s*)[^\s,;]+/gi,
  /("(?:apiKey|api_key|appSecret|app_secret|accessToken|access_token|tenantAccessToken|tenant_access_token|password)"\s*:\s*")[^"]+/gi
];

export function redactLogValue(value) {
  let text = typeof value === 'string' ? value : inspect(value, { depth: 5, breakLength: 120 });
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '$1[REDACTED]');
  return text;
}

function rotateIfNeeded(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < maxBytes) return;
    const rotated = `${filePath}.1`;
    fs.rmSync(rotated, { force: true });
    fs.renameSync(filePath, rotated);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function createDesktopLogger({ filePath, maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!filePath) throw new Error('filePath is required for desktop logging');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  rotateIfNeeded(filePath, maxBytes);

  let queue = Promise.resolve();
  const append = (level, values) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${values.map(redactLogValue).join(' ')}\n`;
    queue = queue.then(() => fs.promises.appendFile(filePath, line, 'utf8')).catch(() => {});
    const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    output(line.trimEnd());
  };

  return Object.freeze({
    filePath,
    info: (...values) => append('info', values),
    warn: (...values) => append('warn', values),
    error: (...values) => append('error', values),
    async close() { await queue; }
  });
}
