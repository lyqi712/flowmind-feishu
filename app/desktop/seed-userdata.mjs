import fs from 'node:fs';
import path from 'node:path';

function copySeedEntry(from, dest) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(from)) copySeedEntry(path.join(from, name), path.join(dest, name));
    return;
  }
  fs.copyFileSync(from, dest);
}

const SEED_FILES = [
  ['state.json', 'state.json'],
  ['state.conversations', 'state.conversations'],
  ['state.conversations.json', 'state.conversations.json'],
  ['state.agent.json', 'state.agent.json'],
  ['state.json.content.sqlite', 'content.sqlite'],
  ['state.json.content.sqlite-wal', 'content.sqlite-wal'],
  ['state.json.content.sqlite-shm', 'content.sqlite-shm'],
  ['feishu-secret.enc', 'feishu-secret.enc'],
  ['.feishu-master-key', '.feishu-master-key'],
  ['model-secret.enc', 'model-secret.enc'],
  ['.model-master-key', '.model-master-key']
];

export function resolveRuntimeSeedDir({ env = process.env, unpackagedRoot, extraCandidates = [] } = {}) {
  const candidates = [
    env.FLOWMIND_RUNTIME_DIR,
    unpackagedRoot ? path.resolve(unpackagedRoot, '..', 'runtime-data') : '',
    ...extraCandidates
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'state.json'))) || null;
}

export function seedUserDataIfEmpty(userData, seedDir) {
  if (!userData || !seedDir) return { seeded: false, reason: 'missing-path' };
  if (fs.existsSync(path.join(userData, 'state.json'))) return { seeded: false, reason: 'already-initialized' };
  if (!fs.existsSync(path.join(seedDir, 'state.json'))) return { seeded: false, reason: 'seed-missing' };
  fs.mkdirSync(userData, { recursive: true });
  const copied = [];
  for (const [fromName, toName] of SEED_FILES) {
    const from = path.join(seedDir, fromName);
    if (!fs.existsSync(from)) continue;
    copySeedEntry(from, path.join(userData, toName));
    copied.push(toName);
  }
  return { seeded: copied.includes('state.json'), copied, seedDir };
}

export function fillMissingUserDataFiles(userData, seedDir) {
  if (!userData || !seedDir) return { copied: [] };
  const copied = [];
  for (const [fromName, toName] of SEED_FILES) {
    if (toName === 'state.json' || toName.startsWith('state.') || toName.startsWith('content.sqlite')) continue;
    const from = path.join(seedDir, fromName);
    const dest = path.join(userData, toName);
    if (!fs.existsSync(from) || fs.existsSync(dest)) continue;
    fs.mkdirSync(userData, { recursive: true });
    fs.copyFileSync(from, dest);
    copied.push(toName);
  }
  return { copied };
}

export function isSharedWorkspace(dir) {
  if (!dir) return false;
  if (!fs.existsSync(path.join(dir, 'state.json'))) return false;
  return fs.existsSync(path.join(dir, 'state.json.content.sqlite')) || fs.existsSync(path.join(dir, 'content.sqlite'));
}

function workspacePaths(dataDir, { contentFile }) {
  return {
    dataDir,
    stateFile: path.join(dataDir, 'state.json'),
    databasePath: path.join(dataDir, contentFile),
    feishuSecretFile: path.join(dataDir, 'feishu-secret.enc'),
    feishuMasterKeyFile: path.join(dataDir, '.feishu-master-key'),
    modelSecretFile: path.join(dataDir, 'model-secret.enc'),
    modelMasterKeyFile: path.join(dataDir, '.model-master-key')
  };
}

export function resolveDesktopWorkspace({
  userData,
  env = process.env,
  unpackagedRoot,
  extraCandidates = [],
  isolated = false
} = {}) {
  const shared = isolated ? null : resolveRuntimeSeedDir({ env, unpackagedRoot, extraCandidates });
  if (isSharedWorkspace(shared)) {
    const contentFile = fs.existsSync(path.join(shared, 'state.json.content.sqlite'))
      ? 'state.json.content.sqlite'
      : 'content.sqlite';
    return { mode: 'shared', ...workspacePaths(shared, { contentFile }) };
  }
  if (!isolated) {
    const seedDir = resolveRuntimeSeedDir({ env, unpackagedRoot, extraCandidates });
    seedUserDataIfEmpty(userData, seedDir);
    fillMissingUserDataFiles(userData, seedDir);
  }
  return { mode: 'userData', ...workspacePaths(userData, { contentFile: 'content.sqlite' }) };
}
