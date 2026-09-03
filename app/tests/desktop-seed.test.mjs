import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fillMissingUserDataFiles, resolveDesktopWorkspace, resolveRuntimeSeedDir, seedUserDataIfEmpty } from '../desktop/seed-userdata.mjs';

test('resolveRuntimeSeedDir 优先使用环境变量', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-seed-env-'));
  try {
    await writeFile(join(root, 'state.json'), '{}\n', 'utf8');
    assert.equal(resolveRuntimeSeedDir({ env: { FLOWMIND_RUNTIME_DIR: root } }), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('空 userData 会复制状态、知识库和密钥', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-seed-'));
  const seedDir = join(root, 'seed');
  const userData = join(root, 'user');
  await mkdir(seedDir);
  await writeFile(join(seedDir, 'state.json'), '{"version":2}\n', 'utf8');
  await writeFile(join(seedDir, 'state.json.content.sqlite'), 'db', 'utf8');
  await writeFile(join(seedDir, 'feishu-secret.enc'), 'secret', 'utf8');
  try {
    const result = seedUserDataIfEmpty(userData, seedDir);
    assert.equal(result.seeded, true);
    assert.equal(await readFile(join(userData, 'state.json'), 'utf8'), '{"version":2}\n');
    assert.equal(await readFile(join(userData, 'content.sqlite'), 'utf8'), 'db');
    assert.equal(await readFile(join(userData, 'feishu-secret.enc'), 'utf8'), 'secret');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('已有工作区时只补缺失密钥', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-seed-fill-'));
  const seedDir = join(root, 'seed');
  const userData = join(root, 'user');
  await mkdir(seedDir);
  await mkdir(userData);
  await writeFile(join(seedDir, 'state.json'), '{"from":"seed"}\n', 'utf8');
  await writeFile(join(seedDir, 'model-secret.enc'), 'model', 'utf8');
  await writeFile(join(userData, 'state.json'), '{"from":"user"}\n', 'utf8');
  try {
    const result = fillMissingUserDataFiles(userData, seedDir);
    assert.deepEqual(result.copied, ['model-secret.enc']);
    assert.equal(await readFile(join(userData, 'state.json'), 'utf8'), '{"from":"user"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('本机 runtime-data 存在时桌面直接共用，不复制', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-shared-'));
  const shared = join(root, 'runtime-data');
  const userData = join(root, 'user');
  await mkdir(shared);
  await mkdir(userData);
  await writeFile(join(shared, 'state.json'), '{"from":"shared"}\n', 'utf8');
  await writeFile(join(shared, 'state.json.content.sqlite'), 'db', 'utf8');
  await writeFile(join(userData, 'state.json'), '{"from":"old-desktop"}\n', 'utf8');
  try {
    const workspace = resolveDesktopWorkspace({
      userData,
      env: { FLOWMIND_RUNTIME_DIR: shared }
    });
    assert.equal(workspace.mode, 'shared');
    assert.equal(workspace.stateFile, join(shared, 'state.json'));
    assert.equal(workspace.databasePath, join(shared, 'state.json.content.sqlite'));
    assert.equal(await readFile(join(userData, 'state.json'), 'utf8'), '{"from":"old-desktop"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('smoke/隔离模式不挂上本机知识库', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-isolated-'));
  const shared = join(root, 'runtime-data');
  const userData = join(root, 'user');
  await mkdir(shared);
  await mkdir(userData);
  await writeFile(join(shared, 'state.json'), '{}\n', 'utf8');
  await writeFile(join(shared, 'state.json.content.sqlite'), 'db', 'utf8');
  try {
    const workspace = resolveDesktopWorkspace({
      userData,
      env: { FLOWMIND_RUNTIME_DIR: shared },
      isolated: true
    });
    assert.equal(workspace.mode, 'userData');
    assert.equal(workspace.stateFile, join(userData, 'state.json'));
    assert.equal(workspace.databasePath, join(userData, 'content.sqlite'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('已有 state.json 时不覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowmind-seed-skip-'));
  const seedDir = join(root, 'seed');
  const userData = join(root, 'user');
  await mkdir(seedDir);
  await mkdir(userData);
  await writeFile(join(seedDir, 'state.json'), '{"from":"seed"}\n', 'utf8');
  await writeFile(join(userData, 'state.json'), '{"from":"user"}\n', 'utf8');
  try {
    const result = seedUserDataIfEmpty(userData, seedDir);
    assert.equal(result.seeded, false);
    assert.equal(await readFile(join(userData, 'state.json'), 'utf8'), '{"from":"user"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
