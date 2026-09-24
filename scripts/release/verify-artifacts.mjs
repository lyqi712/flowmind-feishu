import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const artifactRoot = path.join(appRoot, 'desktop', 'out');
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const version = String(packageJson.version || '').trim();
const expectedArtifacts = [
  `FlowMind-Setup-${version}-x64.exe`,
  `FlowMind-Feishu-AI-Workspace-${version}-x64-portable.zip`
];
const forbiddenEntryPatterns = [
  /(^|\/)(?:state\.json|.*\.(?:sqlite|sqlite3|db|key|enc))(?:$|\/)/i,
  /(^|\/)(?:\.env|\.env\.(?:local|production))(?:$|\/)/i,
  /(^|\/)(?:\.runtime|\.tmp|evidence|logs?)(?:$|\/)/i
];

function walk(directory) {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function zipEntries(filePath) {
  const bytes = readFileSync(filePath);
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = bytes.lastIndexOf(eocdSignature);
  if (eocdOffset < 0 || eocdOffset + 22 > bytes.length) {
    throw new Error(`无法读取 ZIP 内容 ${filePath}: 缺少 central directory`);
  }
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const directoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`无法读取 ZIP 内容 ${filePath}: central directory 无效`);
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error(`无法读取 ZIP 内容 ${filePath}: central directory 越界`);
    entries.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\\\', '/'));
    offset = end;
  }
  return entries;
}

if (!existsSync(artifactRoot)) {
  throw new Error(`发布产物目录不存在: ${artifactRoot}`);
}

const files = walk(artifactRoot);
const artifactPaths = expectedArtifacts.map(name => path.join(artifactRoot, name));
for (const file of artifactPaths) {
  if (!existsSync(file)) throw new Error(`缺少当前版本产物 ${file}`);
}
const executables = artifactPaths.filter(file => /\.exe$/i.test(file));
const archives = artifactPaths.filter(file => /\.zip$/i.test(file));
const violations = [];
for (const file of files) {
  const relative = path.relative(artifactRoot, file).replaceAll('\\', '/');
  if (forbiddenEntryPatterns.some(pattern => pattern.test(relative))) violations.push(relative);
}
for (const archive of archives) {
  for (const entry of zipEntries(archive)) {
    if (forbiddenEntryPatterns.some(pattern => pattern.test(entry))) {
      violations.push(`${path.basename(archive)}::${entry}`);
    }
  }
}

const result = {
  ok: violations.length === 0,
  artifactRoot,
  artifacts: [...new Set([...executables, ...archives])].map(file => ({
    name: path.relative(artifactRoot, file).replaceAll('\\', '/'),
    bytes: statSync(file).size,
    sha256: sha256(file)
  })),
  violations: [...new Set(violations)]
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
