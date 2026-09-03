import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCP_TOOL_GUIDE = [
  { name: 'search_knowledge', use: '按关键词检索知识库和笔记，先找证据再回答。' },
  { name: 'ask_knowledge', use: '基于本地材料问答。citations 为空时必须说库里没有，禁止编造。' },
  { name: 'list_documents', use: '列出当前库里的文档和笔记标题。' },
  { name: 'flowmind_status', use: '查看同步状态和文档数量。' },
  { name: 'run_skill', use: '对已有材料做总结或对比，产物必须带来源。' }
];

export function resolveFlowMindMcpServerPath() {
  const asarPath = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
  const unpacked = asarPath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
  return existsSync(unpacked) ? unpacked : asarPath;
}

export function resolveMcpLaunch({
  serverPath = '',
  apiBaseUrl = 'http://127.0.0.1:8789',
  stateFile = ''
} = {}) {
  const env = {
    FLOWMIND_API_URL: String(apiBaseUrl || 'http://127.0.0.1:8789').replace(/\/$/, '')
  };
  if (stateFile) env.FLOWMIND_STATE_FILE = String(stateFile);
  if (process.versions?.electron) {
    return { command: process.execPath, args: ['--mcp'], env };
  }
  return {
    command: 'node',
    args: [serverPath || resolveFlowMindMcpServerPath()],
    env
  };
}

export function buildMcpConnectKit(options = {}) {
  const resolved = resolveMcpLaunch(options);
  const launch = {
    command: options.nodeCommand || resolved.command,
    args: options.serverPath && !process.versions?.electron ? [options.serverPath] : resolved.args,
    env: { ...resolved.env, ...(options.extraEnv || {}) }
  };
  const claudeDesktop = { mcpServers: { flowmind: launch } };
  const cursor = { mcpServers: { flowmind: { ...launch } } };
  const codex = [
    '[mcp_servers.flowmind]',
    `command = ${JSON.stringify(launch.command)}`,
    `args = [${launch.args.map(item => JSON.stringify(item)).join(', ')}]`,
    '',
    '[mcp_servers.flowmind.env]',
    ...Object.entries(launch.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
  ].join('\n');
  const toolLines = MCP_TOOL_GUIDE.map(item => `- ${item.name}：${item.use}`).join('\n');
  const prompt = [
    '请用 MCP stdio 连接我本机的 FlowMind 知识库。不要编造库里没有的事实。',
    '',
    `command: ${launch.command}`,
    `args: ${JSON.stringify(launch.args)}`,
    ...Object.entries(launch.env).map(([key, value]) => `env.${key}: ${value}`),
    '',
    '先确认 FlowMind 已打开。涉及知识库时先 search_knowledge 或 ask_knowledge；citations 为空就说没有，不要用常识顶替。',
    '',
    toolLines
  ].join('\n');
  return {
    prompt,
    claudeDesktop,
    cursor,
    codex,
    inbound: launch,
    tools: MCP_TOOL_GUIDE
  };
}
