import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const index = trimmed.indexOf('=');
  if (index < 1) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [key, value.replace(/\\n/g, '\n')];
}

export function loadLocalEnv({ cwd = process.cwd(), files = ['.env.local', '.env'] } = {}) {
  const loaded = [];
  for (const file of files) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const pair = parseLine(line);
      if (!pair) continue;
      const [key, value] = pair;
      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(path);
  }
  return loaded;
}
