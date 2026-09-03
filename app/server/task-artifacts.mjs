import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const MIME_TYPES = Object.freeze({
  '.md': 'text/markdown; charset=utf-8',
  '.wav': 'audio/wav'
});

function safeSegment(value, fallback = 'artifact') {
  const normalized = String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 72);
}

function markdownText(value = '') {
  return String(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(Object.assign(new Error(stderr.trim() || `${command} exited with ${code}`), { code: 'PROCESS_FAILED' })));
  });
}

async function synthesizeWindowsSpeech({ text, outputPath, workDir }) {
  const inputPath = join(workDir, 'podcast-script.txt');
  const scriptPath = join(workDir, 'synthesize-podcast.ps1');
  await writeFile(inputPath, markdownText(text).slice(0, 28000), 'utf8');
  await writeFile(scriptPath, [
    'param([string]$InputPath,[string]$OutputPath)',
    'Add-Type -AssemblyName System.Speech',
    '$text = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8)',
    '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$speaker.Rate = 0',
    '$speaker.Volume = 100',
    '$speaker.SetOutputToWaveFile($OutputPath)',
    '$speaker.Speak($text)',
    '$speaker.Dispose()'
  ].join('\r\n'), 'utf8');
  await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, inputPath, outputPath]);
}

async function fileDescriptor(kind, filePath, runId) {
  const info = await stat(filePath);
  const fileName = basename(filePath);
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return {
    kind,
    fileName,
    mimeType: MIME_TYPES[extension] || 'application/octet-stream',
    byteSize: info.size,
    downloadUrl: `/api/skills/artifacts/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}`
  };
}

export function createTaskArtifactService({ dataDir, synthesizeSpeech = synthesizeWindowsSpeech } = {}) {
  if (!dataDir) throw new TypeError('task artifact dataDir is required');
  const rootDir = resolve(dataDir);

  function resolveArtifactPath(runId, fileName) {
    const runDirectory = resolve(rootDir, safeSegment(runId, 'run'));
    const target = resolve(runDirectory, basename(String(fileName || '')));
    if (!target.startsWith(`${runDirectory}${sep}`)) {
      const error = new Error('无效产物路径');
      error.code = 'INVALID_ARTIFACT_PATH';
      throw error;
    }
    return target;
  }

  async function materialize({ runId, skillId, artifact }) {
    if (!artifact || !runId) return artifact;
    const runDirectory = resolve(rootDir, safeSegment(runId, 'run'));
    await mkdir(runDirectory, { recursive: true });
    const title = safeSegment(artifact.title, skillId || 'artifact');
    const sourceRefs = artifact.sourceRefs || artifact.references || [];
    const baseArtifact = { ...artifact, sourceRefs, references: sourceRefs };
    const files = [];

    const markdownPath = join(runDirectory, `${title}.md`);
    await writeFile(markdownPath, `${artifact.content || ''}\n`, 'utf8');
    files.push(await fileDescriptor('document', markdownPath, runId));


    if (skillId === 'podcast') {
      const audioPath = join(runDirectory, `${title}.wav`);
      await synthesizeSpeech({ text: artifact.content, outputPath: audioPath, workDir: runDirectory });
      files.unshift(await fileDescriptor('audio', audioPath, runId));
    }

    return { ...baseArtifact, files };
  }

  async function read(runId, fileName) {
    const filePath = resolveArtifactPath(runId, fileName);
    const bytes = await readFile(filePath);
    return { filePath, fileName: basename(filePath), bytes };
  }

  return { rootDir, materialize, read, resolveArtifactPath };
}
