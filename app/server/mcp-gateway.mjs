import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeMcpConnectors(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const connectors = [];
  for (const raw of items) {
    const name = clean(raw?.name).slice(0, 48);
    const command = clean(raw?.command).slice(0, 240);
    if (!name || !command) continue;
    const id = clean(raw?.id) || `mcp_${randomUUID()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const args = Array.isArray(raw?.args)
      ? raw.args.map(item => clean(item)).filter(Boolean).slice(0, 24)
      : clean(raw?.args).split(/\s+/).filter(Boolean).slice(0, 24);
    connectors.push({
      id,
      name,
      command,
      args,
      enabled: raw?.enabled !== false
    });
    if (connectors.length >= 12) break;
  }
  return connectors;
}

export function publicMcpConnectors(connectors = []) {
  return normalizeMcpConnectors(connectors).map(item => ({
    id: item.id,
    name: item.name,
    command: item.command,
    args: [...item.args],
    enabled: item.enabled
  }));
}

export class McpConnectorGateway {
  constructor({ getConnectors = () => [], createClient = null } = {}) {
    this.getConnectors = getConnectors;
    this.createClient = createClient;
    this.sessions = new Map();
  }

  connectors() {
    return normalizeMcpConnectors(this.getConnectors());
  }

  async list() {
    const connectors = this.connectors().filter(item => item.enabled);
    const tools = [];
    const resources = [];
    const errors = [];
    for (const connector of connectors) {
      try {
        const session = await this.connect(connector);
        const listedTools = await session.client.listTools();
        const listedResources = typeof session.client.listResources === 'function'
          ? await session.client.listResources()
          : { resources: [] };
        for (const tool of listedTools.tools || []) {
          tools.push({
            connectorId: connector.id,
            connectorName: connector.name,
            name: tool.name,
            qualifiedName: `${connector.name}/${tool.name}`,
            description: tool.description || ''
          });
        }
        for (const resource of listedResources.resources || []) {
          resources.push({
            connectorId: connector.id,
            connectorName: connector.name,
            uri: resource.uri,
            name: resource.name || resource.title || resource.uri
          });
        }
      } catch (error) {
        errors.push({ connectorId: connector.id, connectorName: connector.name, message: clean(error?.message) || 'MCP connector unavailable' });
      }
    }
    return { connectors: publicMcpConnectors(connectors), tools, resources, errors };
  }

  async read(uri) {
    const target = clean(uri);
    if (!target) throw Object.assign(new Error('A resource URI is required'), { code: 'MCP_URI_REQUIRED', status: 400 });
    const connectors = this.connectors().filter(item => item.enabled);
    let lastError = null;
    for (const connector of connectors) {
      try {
        const session = await this.connect(connector);
        const result = await session.client.readResource({ uri: target });
        return { connectorId: connector.id, connectorName: connector.name, uri: target, contents: result.contents || [] };
      } catch (error) {
        lastError = error;
      }
    }
    throw Object.assign(new Error(clean(lastError?.message) || 'MCP resource is not available'), { code: 'MCP_RESOURCE_UNAVAILABLE', status: 404 });
  }

  async test(connector) {
    const normalized = normalizeMcpConnectors([connector])[0];
    if (!normalized) throw Object.assign(new Error('MCP connector command and name are required'), { code: 'MCP_CONNECTOR_INVALID', status: 400 });
    const session = await this.connect(normalized, { ephemeral: true });
    try {
      const tools = await session.client.listTools();
      return {
        ok: true,
        connector: publicMcpConnectors([normalized])[0],
        toolCount: (tools.tools || []).length,
        tools: (tools.tools || []).map(tool => tool.name).slice(0, 24)
      };
    } finally {
      await this.closeSession(session);
    }
  }

  async connect(connector, { ephemeral = false } = {}) {
    if (!ephemeral && this.sessions.has(connector.id)) return this.sessions.get(connector.id);
    if (typeof this.createClient === 'function') {
      const session = await this.createClient(connector);
      if (!ephemeral) this.sessions.set(connector.id, session);
      return session;
    }
    const transport = new StdioClientTransport({
      command: connector.command,
      args: connector.args,
      stderr: 'pipe'
    });
    const client = new Client({ name: 'flowmind-mcp-host', version: '1.3.0' });
    await client.connect(transport);
    const session = { client, transport, connectorId: connector.id };
    if (!ephemeral) this.sessions.set(connector.id, session);
    return session;
  }

  async closeSession(session) {
    try { await session?.client?.close?.(); } catch {}
    try { await session?.transport?.close?.(); } catch {}
    if (session?.connectorId) this.sessions.delete(session.connectorId);
  }

  async close() {
    for (const session of this.sessions.values()) await this.closeSession(session);
    this.sessions.clear();
  }
}
