import { fileURLToPath } from 'node:url';

export const MCP_TOOL_GUIDE = [
  { name: 'search_knowledge', use: '按关键词检索知识库和笔记，先找证据再回答。' },
  { name: 'ask_knowledge', use: '基于本地材料问答。返回的 citations 为空时必须告诉用户库里没有，禁止编造。' },
  { name: 'list_documents', use: '列出当前库里的文档和笔记标题。' },
  { name: 'flowmind_status', use: '查看同步状态、文档数量和 Skill 列表。' },
  { name: 'run_skill', use: '对已有材料做总结、对比或研究报告，产物必须带来源。' },
  { name: 'feishu_discover', use: '发现可访问的飞书空间（需本机 FlowMind 正在运行且已配置飞书）。' },
  { name: 'feishu_sync', use: '同步飞书来源到本地库。' }
];

export function resolveFlowMindMcpServerPath() {
  return fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
}

export function buildMcpConnectKit({
  serverPath = resolveFlowMindMcpServerPath(),
  nodeCommand = 'node',
  apiBaseUrl = 'http://127.0.0.1:8789',
  stateFile = ''
} = {}) {
  const env = {
    FLOWMIND_API_URL: String(apiBaseUrl || 'http://127.0.0.1:8789').replace(/\/$/, '')
  };
  if (stateFile) env.FLOWMIND_STATE_FILE = String(stateFile);
  const claudeDesktop = {
    mcpServers: {
      flowmind: {
        command: nodeCommand,
        args: [serverPath],
        env
      }
    }
  };
  const cursor = {
    mcpServers: {
      flowmind: {
        command: nodeCommand,
        args: [serverPath],
        env
      }
    }
  };
  const codex = [
    '[mcp_servers.flowmind]',
    `command = ${JSON.stringify(nodeCommand)}`,
    `args = [${JSON.stringify(serverPath)}]`,
    '',
    '[mcp_servers.flowmind.env]',
    ...Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
  ].join('\n');
  const toolLines = MCP_TOOL_GUIDE.map(item => `- \`${item.name}\`：${item.use}`).join('\n');
  const prompt = [
    '请通过 MCP（stdio）连接我本机正在运行的 FlowMind 知识库，用来查资料、问答和引用。不要编造库里没有的事实。',
    '',
    '连接配置：',
    `command: ${nodeCommand}`,
    `args: ${JSON.stringify([serverPath])}`,
    `env.FLOWMIND_API_URL: ${env.FLOWMIND_API_URL}`,
    env.FLOWMIND_STATE_FILE ? `env.FLOWMIND_STATE_FILE: ${env.FLOWMIND_STATE_FILE}` : '',
    '',
    '请先确认 FlowMind 桌面端或 `npm run start` 已在本机运行。连接成功后：',
    '1. 涉及知识库的问题先调用 search_knowledge 或 ask_knowledge。',
    '2. ask_knowledge 若 citations 为空，直接说库里没有对应材料，不要用常识顶替。',
    '3. 引用时用工具返回的标题和摘录，让我能回到原文。',
    '',
    '可用工具：',
    toolLines
  ].filter(Boolean).join('\n');
  return {
    prompt,
    claudeDesktop,
    cursor,
    codex,
    inbound: {
      command: nodeCommand,
      args: [serverPath],
      env
    },
    tools: MCP_TOOL_GUIDE
  };
}
