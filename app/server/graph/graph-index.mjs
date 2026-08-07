import { createHash, randomUUID } from 'node:crypto';

const PLACEHOLDER_TARGETS = new Set([
  'area name', 'folder name', 'project name', 'resource name', 'wikilink',
  'your note title', 'your title', 'link target', 'example note',
  'note title', 'note title 1', 'note title 2'
]);
const PLACEHOLDER_PATHS = new Set([
  '01-projects/project name', '02-areas/area name', '05-people/name',
  'moc/index', 'moc/related topic', '02-areas/marketing/old campaign brief'
]);
const EXTERNAL_TARGET = /^(?:[a-z][a-z0-9+.-]*:|#)/iu;
const FRONT_MATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u;

function stableId(prefix, ...parts) {
  const digest = createHash('sha256').update(parts.map(part => String(part ?? '')).join('\u001f'), 'utf8').digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function now(clock) {
  return clock().toISOString();
}

function parseJson(value, fallback) {
  if (!value) return structuredClone(fallback);
  try { return JSON.parse(value); } catch { return structuredClone(fallback); }
}

function stringify(value) {
  return JSON.stringify(value ?? {});
}

function clean(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function normalizeLinkTarget(value) {
  return clean(value)
    .replace(/^\[\[!?/, '')
    .replace(/\]\]$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.md$/iu, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function targetBasename(value) {
  const normalized = normalizeLinkTarget(value);
  return normalized.split('/').filter(Boolean).at(-1) || normalized;
}

function isPlaceholderTarget(value) {
  const normalizedPath = normalizeLinkTarget(value);
  const normalized = targetBasename(value);
  if (!normalized || PLACEHOLDER_TARGETS.has(normalized) || PLACEHOLDER_PATHS.has(normalizedPath)) return true;
  if (/^(?:\{[^}]+\}|<[^>]+>|\[?placeholder\]?|todo(?:\s+.+)?)$/iu.test(normalized)) return true;
  return /(?:^|\/)\d{2}-(?:areas|projects|resources|people)\/(?:area|project|resource) name$/iu.test(normalizedPath);
}

function lineAndColumn(text, offset) {
  const before = text.slice(0, Math.max(0, offset));
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return { line, column };
}

function maskCode(text) {
  const lines = String(text || '').split(/\n/);
  let fenced = false;
  return lines.map(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return ' '.repeat(line.length);
    }
    if (fenced) return ' '.repeat(line.length);
    return line.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
  }).join('\n');
}

function parseWikiPayload(payload) {
  const [targetAndAnchor, ...aliasParts] = clean(payload).split('|');
  const hash = targetAndAnchor.indexOf('#');
  const target = clean(hash >= 0 ? targetAndAnchor.slice(0, hash) : targetAndAnchor);
  const anchor = clean(hash >= 0 ? targetAndAnchor.slice(hash + 1) : '');
  return { target, anchor: anchor || null, alias: clean(aliasParts.join('|')) || null };
}

function parseMarkdownDestination(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (raw.startsWith('<') && raw.endsWith('>')) return clean(raw.slice(1, -1));
  const titleSuffix = raw.match(/^(.*?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/u);
  return clean(titleSuffix ? titleSuffix[1] : raw);
}

export function parseExplicitLinks(content = '') {
  const source = String(content || '').replace(/\r\n?/g, '\n');
  const masked = maskCode(source);
  const links = [];
  const wikiPattern = /(!)?\[\[([^\]\n]+)\]\]/gu;
  for (const match of masked.matchAll(wikiPattern)) {
    const offset = Number(match.index || 0);
    const raw = source.slice(offset, offset + match[0].length);
    const parsed = parseWikiPayload(raw.replace(/^!?\[\[|\]\]$/gu, ''));
    if (!parsed.target || EXTERNAL_TARGET.test(parsed.target) || isPlaceholderTarget(parsed.target)) continue;
    const position = lineAndColumn(source, offset);
    links.push({
      kind: match[1] ? 'embed' : 'wikilink',
      raw,
      target: parsed.target,
      normalizedTarget: normalizeLinkTarget(parsed.target),
      anchor: parsed.anchor,
      alias: parsed.alias,
      sourceAnchor: `line:${position.line}:column:${position.column}`,
      offset
    });
  }
  const markdownPattern = /(!)?\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
  for (const match of masked.matchAll(markdownPattern)) {
    const offset = Number(match.index || 0);
    const raw = source.slice(offset, offset + match[0].length);
    const targetAndAnchor = parseMarkdownDestination(match[3]);
    if (!targetAndAnchor || EXTERNAL_TARGET.test(targetAndAnchor)) continue;
    const hash = targetAndAnchor.indexOf('#');
    const target = clean(hash >= 0 ? targetAndAnchor.slice(0, hash) : targetAndAnchor);
    const anchor = clean(hash >= 0 ? targetAndAnchor.slice(hash + 1) : '');
    if (!target || isPlaceholderTarget(target)) continue;
    const position = lineAndColumn(source, offset);
    links.push({
      kind: match[1] ? 'embed' : 'markdown-link',
      raw,
      target,
      normalizedTarget: normalizeLinkTarget(target),
      anchor: anchor || null,
      alias: clean(match[2]) || null,
      sourceAnchor: `line:${position.line}:column:${position.column}`,
      offset
    });
  }
  return links.sort((left, right) => left.offset - right.offset || left.kind.localeCompare(right.kind));
}

export function parseAliasesAndAnchors(content = '', title = '') {
  const source = String(content || '').replace(/\r\n?/g, '\n');
  const aliases = new Set();
  const frontMatter = source.match(FRONT_MATTER)?.[1] || '';
  const aliasMatch = frontMatter.match(/(?:^|\n)aliases?\s*:\s*(?:\[([^\]]*)\]|([^\n]+))/iu);
  if (aliasMatch) {
    const raw = aliasMatch[1] || aliasMatch[2] || '';
    for (const candidate of raw.split(',')) {
      const alias = clean(candidate).replace(/^['"]|['"]$/g, '');
      if (alias) aliases.add(alias);
    }
  }
  const anchors = [];
  const occurrences = new Map();
  for (const match of source.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)) {
    const label = clean(match[2]);
    if (!label) continue;
    const base = normalizeLinkTarget(label).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    const position = lineAndColumn(source, Number(match.index || 0));
    anchors.push({ id: `heading:${base}:${occurrence}`, label, level: match[1].length, line: position.line });
  }
  if (title) aliases.delete(title);
  return { aliases: [...aliases].sort((a, b) => a.localeCompare(b, 'zh-CN')), anchors };
}

function nodeFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.content_item_id || row.id,
    type: row.node_type,
    spaceId: row.space_id || null,
    path: row.path || null,
    label: row.title,
    title: row.title,
    aliases: parseJson(row.aliases_json, []),
    properties: parseJson(row.properties_json, {}),
    versionId: row.version_id ?? null,
    contentHash: row.content_hash || null,
    provenance: parseJson(row.provenance_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function edgeFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    from: row.source_node_id,
    to: row.target_node_id || null,
    type: row.edge_type,
    directed: Boolean(row.directed),
    sourceAnchor: row.source_anchor || null,
    targetAnchor: row.target_anchor || null,
    label: row.label || '',
    parsingStatus: row.parsing_status,
    createdSource: row.created_source,
    sourceId: row.source_content_item_id || null,
    sourceVersionId: row.source_version_id ?? null,
    rawTarget: row.raw_target || null,
    occurrence: row.occurrence || 1,
    provenance: parseJson(row.provenance_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sourceRefIsExplicit(ref) {
  const kind = clean(ref?.provenance?.kind || ref?.kind || ref?.relationKind || '').toLocaleLowerCase();
  return !['inferred-related', 'semantic', 'related-document', 'heuristic'].includes(kind);
}

function stablePath(metadata = {}) {
  const mirror = metadata?.markdownMirror || metadata?.mirror || {};
  return clean(mirror.relativePath || metadata?.mirrorPath || metadata?.relativePath || '') || null;
}

export class GraphIndex {
  constructor({ repository, clock = () => new Date() } = {}) {
    if (!repository?.db) throw new TypeError('repository with a SQLite database is required');
    this.repository = repository;
    this.db = repository.db;
    this.clock = clock;
  }

  rebuild() {
    const items = this.repository.listContentItems({ includeDeleted: false, includeTags: true, limit: 5000 });
    const spaces = this.repository.listSpaces({ includeDeleted: false });
    const timestamp = now(this.clock);
    return this.repository.transaction(() => {
      const oldAliases = new Map(this.db.prepare('SELECT content_item_id, title, aliases_json FROM graph_nodes WHERE content_item_id IS NOT NULL').all()
        .map(row => [row.content_item_id, { title: row.title, aliases: parseJson(row.aliases_json, []) }]));
      this.db.exec('DELETE FROM graph_edges; DELETE FROM graph_nodes;');
      const insertNode = this.db.prepare(`INSERT INTO graph_nodes(
        id, content_item_id, node_type, space_id, path, title, aliases_json, properties_json,
        version_id, content_hash, provenance_json, created_at, updated_at, deleted_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`);
      const insertEdge = this.db.prepare(`INSERT INTO graph_edges(
        id, source_node_id, target_node_id, edge_type, directed, source_anchor, target_anchor,
        label, parsing_status, created_source, source_content_item_id, source_version_id,
        raw_target, occurrence, provenance_json, created_at, updated_at, deleted_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`);
      const nodes = new Map();
      const itemsById = new Map();
      const addNode = node => {
        nodes.set(node.id, node);
        insertNode.run(node.id, node.contentItemId || null, node.type, node.spaceId || null, node.path || null,
          node.title, stringify(node.aliases || []), stringify(node.properties || {}), node.versionId || null,
          node.contentHash || null, stringify(node.provenance || {}), timestamp, timestamp);
      };

      for (const space of spaces) {
        addNode({
          id: `space:${space.id}`,
          type: 'folder',
          spaceId: space.id,
          title: space.name || 'Untitled space',
          aliases: [],
          properties: { spaceType: space.spaceType, externalId: space.externalId },
          provenance: { kind: 'space', sourceConnectionId: space.sourceConnectionId }
        });
      }

      for (const item of items) {
        const metadata = item.metadata || {};
        const parsed = parseAliasesAndAnchors(item.content, item.title);
        const prior = oldAliases.get(item.id);
        const aliases = new Set([...parsed.aliases, ...(prior?.aliases || [])]);
        if (prior?.title && prior.title !== item.title) aliases.add(prior.title);
        aliases.delete(item.title);
        const node = {
          id: `content:${item.id}`,
          contentItemId: item.id,
          type: item.contentType === 'note' ? 'note' : 'document',
          spaceId: item.spaceId || null,
          path: stablePath(metadata),
          title: item.title || 'Untitled item',
          aliases: [...aliases].sort((left, right) => left.localeCompare(right, 'zh-CN')),
          properties: { contentType: item.contentType, externalId: item.externalId, anchors: parsed.anchors, tags: item.tags || [] },
          versionId: item.currentVersionId || null,
          contentHash: item.contentHash || null,
          provenance: { kind: 'content-item', sourceConnectionId: item.sourceConnectionId, sourceUrl: item.sourceUrl || null }
        };
        addNode(node);
        itemsById.set(item.id, { item, node, parsed });
      }

      const tagNodes = new Map();
      const ensureTag = tag => {
        const label = clean(typeof tag === 'object' ? tag.name : tag).replace(/^#/, '');
        if (!label) return null;
        const key = normalizeLinkTarget(label);
        if (tagNodes.has(key)) return tagNodes.get(key);
        const id = `tag:${stableId('tag', key).slice(4)}`;
        addNode({ id, type: 'tag', title: `#${label}`, aliases: [label], properties: { label }, provenance: { kind: 'tag' } });
        tagNodes.set(key, id);
        return id;
      };

      const lookup = new Map();
      const addLookup = (value, nodeId) => {
        const normalized = normalizeLinkTarget(value);
        if (!normalized) return;
        const aliases = lookup.get(normalized) || new Set();
        aliases.add(nodeId);
        lookup.set(normalized, aliases);
        const base = targetBasename(value);
        if (base && base !== normalized) {
          const byBase = lookup.get(base) || new Set();
          byBase.add(nodeId);
          lookup.set(base, byBase);
        }
      };
      for (const { item, node } of itemsById.values()) {
        for (const value of [item.id, item.externalId, item.title, node.path, ...(node.aliases || []), item.metadata?.legacyId]) addLookup(value, node.id);
      }

      const resolveTarget = target => {
        const candidates = [...(lookup.get(normalizeLinkTarget(target)) || lookup.get(targetBasename(target)) || new Set())];
        if (candidates.length === 1) return { status: 'resolved', nodeId: candidates[0] };
        return { status: candidates.length > 1 ? 'ambiguous' : 'unresolved', nodeId: null };
      };
      const addEdge = ({ from, to = null, type, directed = true, sourceAnchor = null, targetAnchor = null, label = '', status = 'resolved', createdSource, sourceItemId = null, sourceVersionId = null, rawTarget = null, provenance = {} }) => {
        const edgeId = stableId('edge', from, to || '', type, sourceAnchor || '', targetAnchor || '', rawTarget || '', label || '');
        insertEdge.run(edgeId, from, to, type, directed ? 1 : 0, sourceAnchor, targetAnchor, label, status,
          createdSource, sourceItemId, sourceVersionId, rawTarget, 1, stringify(provenance), timestamp, timestamp);
      };

      for (const { item, node, parsed } of itemsById.values()) {
        if (node.spaceId && nodes.has(`space:${node.spaceId}`)) {
          addEdge({ from: node.id, to: `space:${node.spaceId}`, type: 'folder', directed: false, createdSource: 'repository-space', sourceItemId: item.id, sourceVersionId: node.versionId, provenance: { kind: 'space-membership', spaceId: node.spaceId } });
        }
        for (const tag of safeArray(item.tags)) {
          const target = ensureTag(tag);
          if (target) addEdge({ from: node.id, to: target, type: 'tag', directed: false, createdSource: 'repository-tag', sourceItemId: item.id, sourceVersionId: node.versionId, provenance: { kind: 'tag-membership', tag: clean(typeof tag === 'object' ? tag.name : tag) } });
        }
        const mirror = Boolean(stablePath(item.metadata));
        if (node.type === 'note' || mirror) {
          for (const link of parseExplicitLinks(item.content)) {
            const resolved = resolveTarget(link.target);
            addEdge({
              from: node.id,
              to: resolved.nodeId,
              type: link.kind === 'embed' ? 'embed' : 'link',
              directed: true,
              sourceAnchor: link.sourceAnchor,
              targetAnchor: link.anchor,
              label: link.alias || '',
              status: resolved.status,
              createdSource: mirror ? 'markdown-mirror-parser' : 'note-parser',
              sourceItemId: item.id,
              sourceVersionId: node.versionId,
              rawTarget: link.target,
              provenance: { kind: 'explicit-link', parser: link.kind, raw: link.raw, sourceAnchor: link.sourceAnchor, targetAnchor: link.anchor, contentHash: node.contentHash }
            });
          }
        }
        if (node.type === 'note') {
          for (const ref of safeArray(item.metadata?.sourceRefs)) {
            if (!sourceRefIsExplicit(ref)) continue;
            const targetId = clean(ref?.documentId || ref?.contentItemId || ref?.id);
            const resolved = resolveTarget(targetId || ref?.title || '');
            if (resolved.status !== 'resolved') continue;
            addEdge({
              from: node.id,
              to: resolved.nodeId,
              type: 'source',
              directed: true,
              sourceAnchor: clean(ref?.sourceAnchor || '') || null,
              targetAnchor: clean(ref?.anchor || '') || null,
              label: clean(ref?.quote || ref?.title || '') || 'Source reference',
              createdSource: 'note-source-reference',
              sourceItemId: item.id,
              sourceVersionId: node.versionId,
              rawTarget: targetId || clean(ref?.title),
              provenance: { kind: 'source-reference', sourceRef: { documentId: targetId || null, anchor: ref?.anchor || null, quote: ref?.quote || null, url: ref?.url || null } }
            });
          }
        }
      }
      return this.snapshot();
    });
  }

  snapshot({ spaceId = '', includeSuggestions = false } = {}) {
    const allNodes = this.db.prepare('SELECT * FROM graph_nodes WHERE deleted_at IS NULL ORDER BY node_type, title, id').all().map(nodeFromRow);
    const allEdges = this.db.prepare(`SELECT * FROM graph_edges
      WHERE deleted_at IS NULL AND parsing_status = 'resolved' AND target_node_id IS NOT NULL
      ORDER BY edge_type, source_node_id, target_node_id, id`).all().map(edgeFromRow);
    let nodes = allNodes;
    let edges = allEdges;
    if (spaceId) {
      const direct = new Set(allNodes.filter(node => node.spaceId === spaceId).map(node => node.id));
      const related = new Set(direct);
      for (const edge of allEdges) {
        if (direct.has(edge.from)) related.add(edge.to);
        if (direct.has(edge.to)) related.add(edge.from);
      }
      nodes = allNodes.filter(node => related.has(node.id));
      const allowed = new Set(nodes.map(node => node.id));
      edges = allEdges.filter(edge => allowed.has(edge.from) && allowed.has(edge.to));
    }
    const degree = new Map(nodes.map(node => [node.id, 0]));
    for (const edge of edges) {
      degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
    }
    const projectedNodes = nodes.map(node => ({ ...node, degree: degree.get(node.id) || 0, orphan: node.type !== 'tag' && node.type !== 'folder' && (degree.get(node.id) || 0) === 0 }));
    const unresolved = this.listUnresolved({ spaceId });
    const suggestions = includeSuggestions ? this.listSuggestions({ status: 'pending' }) : [];
    return {
      nodes: projectedNodes,
      edges,
      unresolved,
      suggestions,
      stats: {
        nodes: projectedNodes.length,
        edges: edges.length,
        unresolved: unresolved.length,
        suggestions: suggestions.length,
        explicitEdges: edges.filter(edge => ['link', 'embed', 'source'].includes(edge.type)).length
      }
    };
  }

  listUnresolved({ spaceId = '' } = {}) {
    const rows = this.db.prepare(`SELECT e.*, n.space_id AS source_space_id, n.title AS source_title
      FROM graph_edges e JOIN graph_nodes n ON n.id = e.source_node_id
      WHERE e.deleted_at IS NULL AND e.parsing_status != 'resolved'
      ORDER BY e.updated_at DESC, e.id`).all();
    return rows.filter(row => !spaceId || row.source_space_id === spaceId).map(row => ({
      ...edgeFromRow(row),
      sourceTitle: row.source_title,
      inbox: true
    }));
  }

  localGraph(nodeId, depth = 1, options = {}) {
    const graph = this.snapshot(options);
    const boundedDepth = Math.max(1, Math.min(3, Number(depth) || 1));
    if (!nodeId || !graph.nodes.some(node => node.id === nodeId)) return graph;
    const neighbours = new Map(graph.nodes.map(node => [node.id, new Set()]));
    for (const edge of graph.edges) {
      neighbours.get(edge.from)?.add(edge.to);
      neighbours.get(edge.to)?.add(edge.from);
    }
    const included = new Set([nodeId]);
    let frontier = new Set([nodeId]);
    for (let level = 0; level < boundedDepth; level += 1) {
      const next = new Set();
      for (const current of frontier) for (const neighbour of neighbours.get(current) || []) {
        if (!included.has(neighbour)) { included.add(neighbour); next.add(neighbour); }
      }
      frontier = next;
      if (!frontier.size) break;
    }
    return {
      ...graph,
      nodes: graph.nodes.filter(node => included.has(node.id)).map(node => ({ ...node, isLocalRoot: node.id === nodeId })),
      edges: graph.edges.filter(edge => included.has(edge.from) && included.has(edge.to))
    };
  }

  getRelations(nodeId) {
    const graph = this.snapshot();
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    return {
      incoming: graph.edges.filter(edge => edge.to === nodeId).map(edge => ({ edge, node: nodeById.get(edge.from) })).filter(row => row.node),
      outgoing: graph.edges.filter(edge => edge.from === nodeId).map(edge => ({ edge, node: nodeById.get(edge.to) })).filter(row => row.node)
    };
  }

  getNodeByContentItem(contentItemId) {
    const row = this.db.prepare('SELECT * FROM graph_nodes WHERE content_item_id = ? AND deleted_at IS NULL LIMIT 1').get(String(contentItemId));
    return nodeFromRow(row);
  }

  createSuggestion({ sourceNodeId, targetNodeId, edgeType = 'link', reason = '', evidence = [], proposedContentItemId = null, proposedPatch = {}, createdSource = 'agent' } = {}) {
    if (!sourceNodeId || !targetNodeId) throw new TypeError('sourceNodeId and targetNodeId are required');
    const source = this.db.prepare('SELECT id FROM graph_nodes WHERE id = ? AND deleted_at IS NULL').get(sourceNodeId);
    const target = this.db.prepare('SELECT id FROM graph_nodes WHERE id = ? AND deleted_at IS NULL').get(targetNodeId);
    if (!source || !target) throw Object.assign(new Error('graph suggestion targets must exist'), { code: 'GRAPH_NODE_NOT_FOUND' });
    const timestamp = now(this.clock);
    const id = `suggestion_${randomUUID()}`;
    this.db.prepare(`INSERT INTO graph_suggestions(
      id, source_node_id, target_node_id, edge_type, status, reason, evidence_json,
      proposed_content_item_id, proposed_patch_json, created_source, created_at, updated_at, confirmed_at
    ) VALUES(?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
      id, sourceNodeId, targetNodeId, edgeType, clean(reason), stringify(evidence), proposedContentItemId,
      stringify(proposedPatch), createdSource, timestamp, timestamp);
    return this.getSuggestion(id);
  }

  getSuggestion(id) {
    const row = this.db.prepare('SELECT * FROM graph_suggestions WHERE id = ?').get(String(id));
    if (!row) return null;
    return {
      id: row.id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type,
      status: row.status,
      reason: row.reason,
      evidence: parseJson(row.evidence_json, []),
      proposedContentItemId: row.proposed_content_item_id,
      proposedPatch: parseJson(row.proposed_patch_json, {}),
      createdSource: row.created_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at
    };
  }

  listSuggestions({ status } = {}) {
    const rows = this.db.prepare(`SELECT * FROM graph_suggestions${status ? ' WHERE status = ?' : ''} ORDER BY created_at DESC`).all(...(status ? [status] : []));
    return rows.map(row => this.getSuggestion(row.id));
  }

  transitionSuggestion(id, status) {
    if (!['approved', 'rejected', 'applied', 'failed'].includes(status)) throw new TypeError('invalid suggestion status');
    const result = this.db.prepare(`UPDATE graph_suggestions
      SET status = ?, updated_at = ?, confirmed_at = CASE WHEN ? IN ('approved','applied') THEN ? ELSE confirmed_at END
      WHERE id = ? AND status = 'pending'`).run(status, now(this.clock), status, now(this.clock), String(id));
    if (!Number(result.changes)) throw Object.assign(new Error('suggestion is not pending'), { code: 'GRAPH_SUGGESTION_NOT_PENDING' });
    return this.getSuggestion(id);
  }
}

export function createGraphIndex(options) {
  return new GraphIndex(options);
}
