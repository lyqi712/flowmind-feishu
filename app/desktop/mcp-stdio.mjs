export function isMcpStdioArgv(argv = process.argv) {
  return (Array.isArray(argv) ? argv : []).some(item => String(item) === '--mcp');
}

export async function startMcpStdio({
  stateFile,
  contentDatabase,
  apiBaseUrl = process.env.FLOWMIND_API_URL || 'http://127.0.0.1:8789'
} = {}) {
  if (!stateFile) throw new Error('MCP stdio requires stateFile');
  const { startFlowMindMcpServer } = await import('../mcp/server.mjs');
  return startFlowMindMcpServer({
    stateFile,
    contentDatabase: contentDatabase || `${stateFile}.content.sqlite`,
    apiBaseUrl
  });
}
