import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpenCheck, CircleDot, FileText, Focus, FolderTree, Link2, LocateFixed, Maximize2, MessageSquarePlus, Network, NotebookPen, Search, Sparkles, Tag, X, ZoomIn, ZoomOut } from 'lucide-react';
import './KnowledgeGraph.css';

export const GRAPH_VIEWBOX = Object.freeze({ width: 1120, height: 720 });

export function graphContainerHasSize(element) {
  const rect = element?.getBoundingClientRect?.();
  return Boolean(rect && rect.width > 1 && rect.height > 1);
}
export const GRAPH_DEFAULTS = Object.freeze({
  centerStrength: 0.518713248970312,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
  showArrow: false
});

const NODE_COLORS = Object.freeze({ document: '#c97759', note: '#2f9e72', tag: '#d58a25', folder: '#267cb9', unresolved: '#a4a198' });
const safeArray = value => Array.isArray(value) ? value : value == null ? [] : [value];
const cleanText = value => String(value ?? '').trim();


function normalizedLookup(value) {
  return cleanText(value).replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0]
    .replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '').trim().toLocaleLowerCase();
}

function slug(value) {
  const normalized = normalizedLookup(value).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

function uniqueTags(...values) {
  const seen = new Set();
  const result = [];
  for (const value of values.flatMap(safeArray)) {
    const label = cleanText(typeof value === 'object' ? value?.name ?? value?.label ?? value?.title : value).replace(/^#/, '');
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function isExplicitSourceRef(ref) {
  const provenance = ref?.provenance && typeof ref.provenance === 'object' ? ref.provenance : {};
  const kind = cleanText(provenance.kind || ref?.kind || ref?.relationKind).toLocaleLowerCase();
  if (kind === 'agent-evidence') return false;
  if (kind) return ['manual-source', 'source-reference', 'explicit-source', 'explicit', 'user-source'].includes(kind);
  return Boolean(cleanText(ref?.documentId || ref?.contentItemId));
}

export function extractWikiLinks(content = '') {
  const links = [];
  const seen = new Set();
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  for (const match of String(content).matchAll(pattern)) {
    const raw = cleanText(match[1]);
    const [targetWithAnchor, alias] = raw.split('|');
    const [target, anchor] = cleanText(targetWithAnchor).split('#');
    const key = normalizedLookup(target);
    if (!key || seen.has(`${key}|${anchor || ''}`)) continue;
    seen.add(`${key}|${anchor || ''}`);
    links.push({ target: cleanText(target), alias: cleanText(alias), anchor: cleanText(anchor), raw: match[0] });
  }
  return links;
}

function flattenLinkValue(value, fallbackType = 'link') {
  if (value == null) return [];
  if (typeof value === 'string' || typeof value === 'number') return [{ target: String(value), type: fallbackType }];
  if (Array.isArray(value)) return value.flatMap(entry => flattenLinkValue(entry, fallbackType));
  if (typeof value !== 'object') return [];
  const directTarget = value.target ?? value.title ?? value.path ?? value.href ?? value.documentId ?? value.contentItemId ?? value.noteId ?? value.id;
  if (directTarget != null) return [{ ...value, target: directTarget, type: value.type || fallbackType }];
  return Object.entries(value).flatMap(([target, count]) => {
    if (count && typeof count === 'object') return [{ ...count, target, type: count.type || fallbackType }];
    return [{ target, count: Number(count) || 1, type: fallbackType }];
  });
}

function collectOutboundLinks(item) {
  const metadata = item?.metadata || {};
  const sources = [
    [item?.outboundLinks, false], [item?.outbound, false], [item?.links, false],
    [metadata.outboundLinks, false], [metadata.outbound, false], [metadata.links, false],
    [metadata.resolvedLinks, false], [metadata.unresolvedLinks, true]
  ];
  return [
    ...sources.flatMap(([value, unresolved]) => flattenLinkValue(value).map(link => unresolved ? { ...link, unresolved: true, resolved: false } : link)),
    ...extractWikiLinks(item?.content).map(link => ({ ...link, type: 'link' }))
  ].filter(link => !isTemplateGraphTarget(link?.target));
}

const isExternalTarget = target => /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(cleanText(target));
const GRAPH_TEMPLATE_TARGETS = new Set(['area name', 'folder name', 'project name', 'resource name', 'wikilink', 'note title', 'note title 1', 'note title 2']);
const GRAPH_TEMPLATE_PATHS = new Set(['01-projects/project name', '02-areas/area name', '05-people/name', 'moc/index', 'moc/related topic', '02-areas/marketing/old campaign brief']);

function graphTargetPath(value) {
  return cleanText(value).replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0]
    .replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').trim().toLocaleLowerCase();
}

function isTemplateGraphTarget(target) {
  const path = graphTargetPath(target);
  const base = path.split('/').filter(Boolean).at(-1) || path;
  return GRAPH_TEMPLATE_TARGETS.has(base) || GRAPH_TEMPLATE_PATHS.has(path);
}

function nodeIdFor(type, item, index) {
  const sourceId = cleanText(item?.id ?? item?.documentId ?? item?.noteId ?? item?.contentItemId);
  return `${type}:${sourceId || `${slug(item?.title || type)}-${index + 1}`}`;
}

function edgeKey(from, to, type, directed) {
  if (!directed && from > to) [from, to] = [to, from];
  return `${type}:${from}->${to}:${directed ? 'd' : 'u'}`;
}

function resolveTarget(link, registries) {
  const explicitDocumentId = cleanText(link?.documentId ?? link?.contentItemId);
  const explicitNoteId = cleanText(link?.noteId);
  if (explicitDocumentId && registries.documentIds.has(explicitDocumentId)) return registries.documentIds.get(explicitDocumentId);
  if (explicitNoteId && registries.noteIds.has(explicitNoteId)) return registries.noteIds.get(explicitNoteId);
  const rawTarget = cleanText(link?.target ?? link?.title ?? link?.path ?? link?.href ?? link?.id);
  if (!rawTarget || isExternalTarget(rawTarget) || rawTarget.startsWith('#')) return null;
  if (registries.allIds.has(rawTarget)) return registries.allIds.get(rawTarget);
  return registries.titles.get(normalizedLookup(rawTarget)) || null;
}

function subsetGraph(graph, nodeIds, rootId = null) {
  const allowed = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  return {
    nodes: graph.nodes.filter(node => allowed.has(node.id)).map(node => ({ ...node, isLocalRoot: node.id === rootId })),
    edges: graph.edges.filter(edge => allowed.has(edge.from) && allowed.has(edge.to))
  };
}

export function buildKnowledgeGraph({ documents = [], notes = [] } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const registries = { documentIds: new Map(), noteIds: new Map(), allIds: new Map(), titles: new Map() };
  const addNode = node => {
    if (!node?.id) return null;
    const current = nodes.get(node.id);
    nodes.set(node.id, current ? { ...current, ...node, tags: uniqueTags(current.tags, node.tags) } : node);
    return node.id;
  };
  const addEntity = (item, type, index) => {
    const id = nodeIdFor(type, item, index);
    const sourceId = cleanText(item?.id ?? item?.documentId ?? item?.noteId ?? item?.contentItemId);
    const title = cleanText(item?.title) || (type === 'document' ? '无标题文档' : '无标题笔记');
    const tags = uniqueTags(item?.tags, item?.metadata?.tags);
    addNode({ id, sourceId, type, label: title, title, tags, subtitle: type === 'document' ? cleanText(item?.contentType || item?.metadata?.fileName || '文档') : '笔记', raw: item, color: NODE_COLORS[type] });
    if (sourceId) {
      registries.allIds.set(sourceId, id);
      (type === 'document' ? registries.documentIds : registries.noteIds).set(sourceId, id);
    }
    registries.allIds.set(id, id);
    for (const lookup of [title, item?.metadata?.fileName, item?.path, item?.sourcePath]) {
      const key = normalizedLookup(lookup);
      if (key && !registries.titles.has(key)) registries.titles.set(key, id);
    }
    return id;
  };

  const documentRows = safeArray(documents).filter(Boolean);
  const noteRows = safeArray(notes).filter(note => note && !note.archived);
  const documentNodeIds = documentRows.map((item, index) => addEntity(item, 'document', index));
  const noteNodeIds = noteRows.map((item, index) => addEntity(item, 'note', index));

  const ensureUnresolved = target => {
    const label = cleanText(target) || '未解析链接';
    const id = `unresolved:${slug(label)}`;
    addNode({ id, sourceId: '', type: 'unresolved', label, title: label, tags: [], subtitle: '未解析链接', raw: null, color: NODE_COLORS.unresolved });
    return id;
  };
  const addEdge = ({ from, to, type = 'link', directed = true, resolved = true, weight = 1, label = '' }) => {
    if (!from || !to || from === to || !nodes.has(from) || !nodes.has(to)) return;
    const key = edgeKey(from, to, type, directed);
    const current = edges.get(key);
    if (current) { current.weight += Number(weight) || 1; current.count += 1; current.label = current.label || label; return; }
    edges.set(key, { id: `edge:${key}`, from, to, type, directed, resolved, weight: Number(weight) || 1, count: 1, label });
  };

  documentRows.forEach((document, index) => {
    const from = documentNodeIds[index];
    for (const link of collectOutboundLinks(document)) {
      const rawTarget = cleanText(link?.target);
      let to = resolveTarget(link, registries);
      if ((!to || link?.resolved === false || link?.unresolved === true) && rawTarget && !isExternalTarget(rawTarget)) to = ensureUnresolved(rawTarget);
      if (to) addEdge({ from, to, type: link?.type === 'embed' ? 'embed' : 'link', directed: true, resolved: nodes.get(to)?.type !== 'unresolved', weight: link?.count || 1, label: link?.alias || '' });
    }
  });

  noteRows.forEach((note, index) => {
    const from = noteNodeIds[index];
    for (const link of collectOutboundLinks(note)) {
      const rawTarget = cleanText(link?.target);
      let to = resolveTarget(link, registries);
      if (!to && rawTarget && !isExternalTarget(rawTarget)) to = ensureUnresolved(rawTarget);
      if (to) addEdge({ from, to, type: 'link', directed: true, resolved: nodes.get(to)?.type !== 'unresolved', weight: link?.count || 1, label: link?.alias || '' });
    }
    for (const ref of safeArray(note?.sourceRefs)) {
      if (!isExplicitSourceRef(ref)) continue;
      const to = resolveTarget(ref, registries);
      if (to) addEdge({ from, to, type: 'source', directed: true, resolved: true, label: cleanText(ref?.anchor || ref?.title) });
    }
  });


  // Semantic similarity is intentionally isolated from the explicit-provenance graph.

  [...documentRows.map((item, index) => [item, documentNodeIds[index]]), ...noteRows.map((item, index) => [item, noteNodeIds[index]])].forEach(([item, from]) => {
    for (const tagLabel of uniqueTags(item?.tags, item?.metadata?.tags)) {
      const tagId = `tag:${slug(tagLabel)}`;
      addNode({ id: tagId, sourceId: tagLabel, type: 'tag', label: `#${tagLabel}`, title: tagLabel, tags: [], subtitle: '标签', raw: null, color: NODE_COLORS.tag });
      addEdge({ from, to: tagId, type: 'tag', directed: false, resolved: true });
    }
  });

  const nodeRows = [...nodes.values()];
  const edgeRows = [...edges.values()];
  const degree = new Map(nodeRows.map(node => [node.id, 0]));
  const structuralDegree = new Map(nodeRows.map(node => [node.id, 0]));
  for (const edge of edgeRows) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
    if (edge.type !== 'tag') {
      structuralDegree.set(edge.from, (structuralDegree.get(edge.from) || 0) + 1);
      structuralDegree.set(edge.to, (structuralDegree.get(edge.to) || 0) + 1);
    }
  }
  return {
    nodes: nodeRows.map(node => { const connections = degree.get(node.id) || 0; return { ...node, degree: connections, weight: 1 + Math.sqrt(connections), orphan: node.type !== 'tag' && (structuralDegree.get(node.id) || 0) === 0 }; }),
    edges: edgeRows
  };
}

export function filterKnowledgeGraph(graph, options = {}) {
  const { query = '', showDocuments = true, showNotes = true, showTags = true, showUnresolved = true, showOrphans = true, includeSearchNeighbors = true } = options;
  const enabled = { document: showDocuments, note: showNotes, tag: showTags, unresolved: showUnresolved };
  const candidates = graph.nodes.filter(node => enabled[node.type] !== false && (showOrphans || !node.orphan));
  const normalizedQuery = cleanText(query).toLocaleLowerCase();
  if (!normalizedQuery) return subsetGraph(graph, new Set(candidates.map(node => node.id)));
  const candidateIds = new Set(candidates.map(node => node.id));
  const directMatches = new Set(candidates.filter(node => [node.label, node.subtitle, ...safeArray(node.tags)].join(' ').toLocaleLowerCase().includes(normalizedQuery)).map(node => node.id));
  const matched = new Set(directMatches);
  if (includeSearchNeighbors) {
    for (const edge of graph.edges) {
      if (directMatches.has(edge.from) && candidateIds.has(edge.to)) matched.add(edge.to);
      if (directMatches.has(edge.to) && candidateIds.has(edge.from)) matched.add(edge.from);
    }
  }
  return subsetGraph(graph, matched);
}

export function buildLocalGraph(graph, rootId, jumps = 1) {
  if (!rootId || !graph.nodes.some(node => node.id === rootId)) return graph;
  const maxDepth = Math.min(3, Math.max(1, Number(jumps) || 1));
  const neighbors = new Map(graph.nodes.map(node => [node.id, new Set()]));
  for (const edge of graph.edges) {
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }
  const included = new Set([rootId]);
  let frontier = new Set([rootId]);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = new Set();
    for (const id of frontier) for (const neighbor of neighbors.get(id) || []) if (!included.has(neighbor)) {
      included.add(neighbor);
      next.add(neighbor);
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return subsetGraph(graph, included, rootId);
}

function hashNumber(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function createKnowledgeGraphLayout(graph, options = {}) {
  const width = Number(options.width) || GRAPH_VIEWBOX.width;
  const height = Number(options.height) || GRAPH_VIEWBOX.height;
  const settings = { ...GRAPH_DEFAULTS, ...options };
  const nodes = graph.nodes || [];
  const positions = {};
  if (!nodes.length) return positions;
  const centerX = width / 2;
  const centerY = height / 2;
  const initialRadius = Math.min(width, height) * 0.34;
  nodes.forEach((node, index) => {
    const seed = hashNumber(node.id);
    const angle = (index * 2.399963229728653) + ((seed % 1000) / 1000) * 0.42;
    const radius = initialRadius * (0.35 + 0.65 * Math.sqrt((index + 1) / nodes.length));
    positions[node.id] = { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const velocities = nodes.map(() => ({ x: 0, y: 0 }));
  const iterations = Math.max(18, Math.min(72, Math.round(6400 / Math.max(90, nodes.length))));
  const repelBase = settings.repelStrength * 125;
  const targetDistance = Math.min(settings.linkDistance, Math.min(width, height) * 0.38);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;
    for (let left = 0; left < nodes.length; left += 1) {
      const leftPosition = positions[nodes[left].id];
      velocities[left].x += (centerX - leftPosition.x) * settings.centerStrength * 0.0009;
      velocities[left].y += (centerY - leftPosition.y) * settings.centerStrength * 0.0009;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const rightPosition = positions[nodes[right].id];
        let dx = rightPosition.x - leftPosition.x;
        let dy = rightPosition.y - leftPosition.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1) {
          dx = ((hashNumber(nodes[left].id + ':' + nodes[right].id) % 11) - 5) / 10;
          dy = 1;
          distanceSquared = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(4.5, repelBase / distanceSquared) * cooling;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        velocities[left].x -= fx;
        velocities[left].y -= fy;
        velocities[right].x += fx;
        velocities[right].y += fy;
      }
    }
    for (const edge of graph.edges || []) {
      const fromIndex = nodeIndex.get(edge.from);
      const toIndex = nodeIndex.get(edge.to);
      if (fromIndex == null || toIndex == null) continue;
      const from = positions[edge.from];
      const to = positions[edge.to];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (distance - targetDistance) * settings.linkStrength * 0.0018 * cooling * Math.min(2, edge.weight || 1);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      velocities[fromIndex].x += fx;
      velocities[fromIndex].y += fy;
      velocities[toIndex].x -= fx;
      velocities[toIndex].y -= fy;
    }
    nodes.forEach((node, index) => {
      const velocity = velocities[index];
      velocity.x *= 0.82;
      velocity.y *= 0.82;
      const position = positions[node.id];
      position.x = Math.max(34, Math.min(width - 34, position.x + velocity.x));
      position.y = Math.max(34, Math.min(height - 34, position.y + velocity.y));
    });
  }
  return positions;
}

export function getKnowledgeGraphRelations(graph, nodeId) {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = [];
  const outgoing = [];
  for (const edge of graph.edges) {
    if (edge.from === nodeId && nodeById.has(edge.to)) outgoing.push({ edge, node: nodeById.get(edge.to) });
    if (edge.to === nodeId && nodeById.has(edge.from)) incoming.push({ edge, node: nodeById.get(edge.from) });
  }
  const byLabel = (left, right) => left.node.label.localeCompare(right.node.label, 'zh-CN');
  return { incoming: incoming.sort(byLabel), outgoing: outgoing.sort(byLabel) };
}

export function summarizeKnowledgeGraphRelations(graph, limit = 8) {
  const nodeById = new Map((graph?.nodes || []).map(node => [node.id, node]));
  const priority = { source: 5, link: 4, embed: 4, semantic: 3, tag: 1 };
  return (graph?.edges || [])
    .map(edge => ({ edge, from: nodeById.get(edge.from), to: nodeById.get(edge.to) }))
    .filter(row => row.from && row.to && row.edge.resolved !== false && row.from.type !== 'unresolved' && row.to.type !== 'unresolved')
    .sort((left, right) => (priority[right.edge.type] || 0) - (priority[left.edge.type] || 0) || (right.edge.weight || 0) - (left.edge.weight || 0) || left.from.label.localeCompare(right.from.label, 'zh-CN'))
    .slice(0, Math.max(1, Number(limit) || 8))
    .map(({ edge, from, to }) => ({
      id: edge.id,
      fromId: from.id,
      toId: to.id,
      fromLabel: from.label,
      toLabel: to.label,
      type: edge.type,
      label: edge.label || edgeLabel(edge.type),
      directed: Boolean(edge.directed),
      weight: edge.weight || 1
    }));
}

export function openKnowledgeGraphNode(node, { onOpenDocument, onOpenNote, anchor = null, evidence = null } = {}) {
  if (!node) return false;
  const target = { ...(node.raw || {}), ...(node.sourceRef || {}), ...(evidence || {}), id: node.sourceId, documentId: node.sourceId, title: node.label, contentVersionId: evidence?.contentVersionId ?? node.contentVersionId ?? node.versionId ?? node.sourceRef?.contentVersionId ?? null, contentHash: evidence?.contentHash ?? node.contentHash ?? node.sourceRef?.contentHash ?? null, ...(anchor ? { anchor } : {}) };
  if (node.type === 'document') { onOpenDocument?.(target); return typeof onOpenDocument === 'function'; }
  if (node.type === 'note') { onOpenNote?.(target); return typeof onOpenNote === 'function'; }
  return false;
}

function fitViewport(positions) {
  const values = Object.values(positions || {});
  if (!values.length) return { x: 0, y: 0, scale: 1 };
  const xs = values.map(position => position.x);
  const ys = values.map(position => position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const contentWidth = Math.max(180, maxX - minX + 140);
  const contentHeight = Math.max(140, maxY - minY + 140);
  const scale = Math.max(0.38, Math.min(1.35, Math.min(GRAPH_VIEWBOX.width / contentWidth, GRAPH_VIEWBOX.height / contentHeight)));
  return { scale, x: GRAPH_VIEWBOX.width / 2 - ((minX + maxX) / 2) * scale, y: GRAPH_VIEWBOX.height / 2 - ((minY + maxY) / 2) * scale };
}

function nodeRadius(node) {
  const base = node.type === 'tag' ? 8 : node.type === 'unresolved' ? 7 : 10;
  return Math.min(22, base + Math.max(0, node.weight - 1) * 2.8);
}

const typeLabel = type => ({ document: '文档', note: '笔记', tag: '标签', folder: '文件夹', unresolved: '未解析' })[type] || type;

export function buildKnowledgeObservationQuestions(node, relations = { incoming: [], outgoing: [] }) {
  const title = cleanText(node?.label) || '当前知识';
  const relationCount = Number(relations?.incoming?.length || 0) + Number(relations?.outgoing?.length || 0);
  return [
    { id: 'core', label: '核心结论', prompt: `总结“${title}”的核心结论，并给出原文依据。` },
    { id: 'relations', label: '关联观察', prompt: relationCount ? `分析“${title}”与相邻知识的共识、冲突和因果关系。` : `分析“${title}”可能与知识库中哪些内容相关，并说明判断依据。` },
    { id: 'questions', label: '待验证问题', prompt: `围绕“${title}”列出最值得继续验证的问题、缺失证据和下一步。` }
  ];
}
const edgeLabel = type => ({ link: '链接到', embed: '嵌入', source: '来源于', tag: '带有标签', folder: '位于文件夹', suggestion: 'AI 建议', semantic: '主题相似' })[type] || type;

export function resolveGraphNodeId(graph, requestedId) {
  const raw = String(requestedId || '').trim();
  if (!raw) return '';
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const stripped = raw.replace(/^(?:content|document|note):/, '');
  const candidates = [raw, `content:${stripped}`, `document:${stripped}`, `note:${stripped}`, stripped];
  for (const candidate of candidates) {
    const match = nodes.find(node => node.id === candidate || node.contentItemId === candidate || node.sourceId === candidate);
    if (match) return match.id;
  }
  return raw;
}

function normalizeIndexedGraph(graphData) {
  if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) return null;
  return {
    nodes: graphData.nodes.map(node => ({
      ...node,
      sourceId: node.contentItemId || node.sourceId || String(node.id || '').replace(/^(?:content|document|note):/, ''),
      label: node.label || node.title || 'Untitled',
      title: node.title || node.label || 'Untitled',
      tags: uniqueTags(node.tags, node.properties?.tags),
      raw: node.raw || null,
      color: node.color || NODE_COLORS[node.type] || NODE_COLORS.document,
      weight: Number(node.weight) || 1 + Math.sqrt(Number(node.degree) || 0)
    })),
    edges: graphData.edges.map(edge => ({
      ...edge,
      from: edge.from || edge.sourceNodeId,
      to: edge.to || edge.targetNodeId,
      resolved: edge.parsingStatus ? edge.parsingStatus === 'resolved' : edge.resolved !== false,
      weight: Number(edge.weight) || 1,
      label: edge.label || ''
    })),
    unresolved: Array.isArray(graphData.unresolved) ? graphData.unresolved : [],
    suggestions: Array.isArray(graphData.suggestions) ? graphData.suggestions : []
  };
}



function NodeTypeIcon({ type, size = 14 }) {
  if (type === 'document') return <FileText size={size}/>;
  if (type === 'note') return <NotebookPen size={size}/>;
  if (type === 'tag') return <Tag size={size}/>;
  if (type === 'folder') return <FolderTree size={size}/>;
  return <CircleDot size={size}/>;
}

export function KnowledgeGraph({ documents = [], notes = [], graph: graphData = null, loading = false, initialRootId = '', initialLocalMode = false, onOpenDocument, onOpenNote, onAskNode, onCreateNote, onOpenEvidenceWorkbench, onConfirmSuggestion, onRefreshGraph, onClose }) {
  const markerId = 'knowledge-graph-arrow-' + useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const positionsRef = useRef({});
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ showDocuments: true, showNotes: true, showTags: true, showUnresolved: false, showOrphans: false });
  const [localMode, setLocalMode] = useState(Boolean(initialLocalMode && initialRootId));
  const [localJumps, setLocalJumps] = useState(1);
  const [localRootId, setLocalRootId] = useState(initialRootId || '');
  const [showArrows, setShowArrows] = useState(GRAPH_DEFAULTS.showArrow);
  const [mirrorStatus, setMirrorStatus] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(initialRootId || '');
  const [selectedRelation, setSelectedRelation] = useState(null);
  const [positions, setPositions] = useState({});
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });

  const legacyGraph = useMemo(() => buildKnowledgeGraph({ documents, notes }), [documents, notes]);
  const fullGraph = useMemo(() => normalizeIndexedGraph(graphData) || legacyGraph, [graphData, legacyGraph]);
  const resolvedInitialRootId = useMemo(() => resolveGraphNodeId(fullGraph, initialRootId), [fullGraph, initialRootId]);
  const effectiveRootId = localRootId || selectedNodeId || resolvedInitialRootId || fullGraph.nodes.find(node => node.type === 'document' || node.type === 'note')?.id || '';
  const scopedGraph = useMemo(() => localMode ? buildLocalGraph(fullGraph, effectiveRootId, localJumps) : fullGraph, [fullGraph, localMode, effectiveRootId, localJumps]);
  const visibleGraph = useMemo(() => filterKnowledgeGraph(scopedGraph, { ...filters, query }), [scopedGraph, filters, query]);
  const layoutKey = useMemo(() => visibleGraph.nodes.map(node => node.id).sort().join('|') + '::' + visibleGraph.edges.map(edge => edge.id).sort().join('|'), [visibleGraph]);

  useEffect(() => {
    const next = createKnowledgeGraphLayout(visibleGraph);
    positionsRef.current = next;
    setPositions(next);
    const fitted = fitViewport(next);
    viewportRef.current = fitted;
    setViewport(fitted);
    if (selectedNodeId && !visibleGraph.nodes.some(node => node.id === selectedNodeId)) setSelectedNodeId('');
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { positionsRef.current = positions; }, [positions]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => {
    if (!resolvedInitialRootId) return;
    setSelectedNodeId(resolvedInitialRootId);
    setLocalRootId(resolvedInitialRootId);
    if (initialLocalMode) setLocalMode(true);
  }, [resolvedInitialRootId, initialLocalMode]);

  const selectedNode = visibleGraph.nodes.find(node => node.id === selectedNodeId) || fullGraph.nodes.find(node => node.id === selectedNodeId) || null;
  const relations = selectedNode ? getKnowledgeGraphRelations(fullGraph, selectedNode.id) : { incoming: [], outgoing: [] };
  const relatedNodes = [...relations.outgoing, ...relations.incoming].map(row => row.node).filter(Boolean);
  const observationQuestions = selectedNode ? buildKnowledgeObservationQuestions(selectedNode, relations) : [];
  const counts = useMemo(() => fullGraph.nodes.reduce((result, node) => ({ ...result, [node.type]: (result[node.type] || 0) + 1 }), {}), [fullGraph]);
  const pendingSuggestions = useMemo(() => (fullGraph.suggestions || []).filter(item => !item.status || item.status === 'pending'), [fullGraph]);
  const unresolvedCount = Number(fullGraph.unresolved?.length || 0);
  const relationSummary = useMemo(() => summarizeKnowledgeGraphRelations(fullGraph, 10), [fullGraph]);
  const visibleLabelIds = useMemo(() => {
    const graphIsDense = visibleGraph.nodes.length > 34 || visibleGraph.edges.length > 70;
    if (!graphIsDense) return new Set(visibleGraph.nodes.map(node => node.id));
    return new Set(visibleGraph.nodes
      .filter(node => node.type === 'document' || node.type === 'note')
      .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label, 'zh-CN'))
      .slice(0, 9)
      .map(node => node.id));
  }, [visibleGraph]);

  function updateViewport(next) { viewportRef.current = next; setViewport(next); }
  function zoomBy(factor, focus = { x: GRAPH_VIEWBOX.width / 2, y: GRAPH_VIEWBOX.height / 2 }) {
    const current = viewportRef.current;
    const scale = Math.max(0.28, Math.min(3.5, current.scale * factor));
    const graphX = (focus.x - current.x) / current.scale;
    const graphY = (focus.y - current.y) / current.scale;
    updateViewport({ scale, x: focus.x - graphX * scale, y: focus.y - graphY * scale });
  }
  function eventPoint(event) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width) * GRAPH_VIEWBOX.width, y: ((event.clientY - rect.top) / rect.height) * GRAPH_VIEWBOX.height };
  }
  function handleWheel(event) { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.12 : 0.89, eventPoint(event)); }
  function handleCanvasPointerDown(event) {
    if (event.button !== 0 || event.target.closest?.('[data-graph-node="true"]')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { type: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, viewport: viewportRef.current, moved: false };
  }
  function handleNodePointerDown(event, nodeId) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { type: 'node', pointerId: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY, position: positionsRef.current[nodeId], moved: false };
    setSelectedNodeId(nodeId);
  }
  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.type === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      updateViewport({ ...drag.viewport, x: drag.viewport.x + (dx / rect.width) * GRAPH_VIEWBOX.width, y: drag.viewport.y + (dy / rect.height) * GRAPH_VIEWBOX.height });
      return;
    }
    const point = eventPoint(event);
    const currentViewport = viewportRef.current;
    const nextPosition = { x: (point.x - currentViewport.x) / currentViewport.scale, y: (point.y - currentViewport.y) / currentViewport.scale };
    setPositions(current => ({ ...current, [drag.nodeId]: nextPosition }));
  }
  function handlePointerUp(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.type === 'node' && drag.moved;
    dragRef.current = null;
    for (const target of [event.target, event.currentTarget]) {
      if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }
  }
  function activateNode(node) {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    setSelectedNodeId(node.id);
    setSelectedRelation(null);
    if (localMode) setLocalRootId(node.id);
  }
  function openSelectedNode(node = selectedNode) {
    if (!node) return;
    openKnowledgeGraphNode(node, { onOpenDocument, onOpenNote, anchor: relationAnchorFor(node, selectedRelation), evidence: relationEvidenceFor(selectedRelation) });
  }
  function toggleFilter(key) { setFilters(current => ({ ...current, [key]: !current[key] })); }
  function toggleLocalMode() {
    setLocalMode(current => {
      const next = !current;
      if (next) setLocalRootId(selectedNodeId || effectiveRootId);
      return next;
    });
  }
  function resetView() { updateViewport(fitViewport(positionsRef.current)); }
  async function syncMarkdownMirror() {
    const desktop = globalThis.flowMindDesktop;
    if (!desktop?.chooseMarkdownRoot || !desktop?.scanMarkdownRoot || !desktop?.confirmMarkdownWrite) {
      setMirrorStatus('Markdown mirror is available in the desktop app after selecting a folder.');
      return;
    }
    try {
      setMirrorStatus('Selecting a Markdown folder…');
      const selected = await desktop.chooseMarkdownRoot();
      if (selected?.cancelled) { setMirrorStatus('Markdown folder selection was cancelled.'); return; }
      const rootResult = await fetch('/api/markdown-mirror/roots', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rootToken: selected.rootId, displayName: selected.displayName })
      }).then(response => response.ok ? response.json() : response.json().then(data => Promise.reject(new Error(data?.error?.message || `HTTP ${response.status}`))));
      const scanned = await desktop.scanMarkdownRoot(selected.rootId);
      const syncResult = await fetch(`/api/markdown-mirror/roots/${encodeURIComponent(rootResult.root.id)}/scan`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: scanned.files || [] })
      }).then(response => response.ok ? response.json() : response.json().then(data => Promise.reject(new Error(data?.error?.message || `HTTP ${response.status}`))));
      let writes = 0;
      for (const pending of syncResult.pendingWrites || []) {
        const approved = globalThis.confirm?.(`Write the confirmed FlowMind change to ${pending.relativePath}?`) === true;
        if (!approved) continue;
        await desktop.confirmMarkdownWrite({ rootId: selected.rootId, relativePath: pending.relativePath, content: pending.content });
        await fetch(`/api/markdown-mirror/roots/${encodeURIComponent(rootResult.root.id)}/writes/confirmed`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relativePath: pending.relativePath, contentHash: pending.contentHash })
        });
        writes += 1;
      }
      setMirrorStatus(`${syncResult.stats?.created || 0} imported · ${syncResult.stats?.conflicts || 0} conflicts · ${writes} confirmed writes`);
      await onRefreshGraph?.();
    } catch (error) {
      setMirrorStatus(error?.message || 'Markdown mirror sync failed.');
    }
  }
  function relationEvidenceFor(edge) {
    return edge?.provenance?.sourceRef || edge?.provenance?.boundSource || null;
  }
  function relationAnchorFor(node, edge) {
    if (!edge || !node) return null;
    if (edge.to === node.id) return edge.targetAnchor || null;
    if (edge.from === node.id) return edge.sourceAnchor || null;
    return null;
  }
  function selectRelated(node, edge) {
    setSelectedNodeId(node.id);
    setSelectedRelation(edge || null);
    if (localMode) setLocalRootId(node.id);
  }
  function suggestionLabel(nodeId) {
    return fullGraph.nodes.find(item => item.id === nodeId)?.label || nodeId;
  }
  function visibleSuggestions(node = null) {
    if (!node) return pendingSuggestions;
    return pendingSuggestions.filter(item => item.sourceNodeId === node.id || item.targetNodeId === node.id);
  }

  return (
    <section className="knowledge-graph" aria-label="知识观察">
      <header className="knowledge-graph-header">
        <div className="knowledge-graph-heading">
          <span className="knowledge-graph-mark"><Network size={19}/></span>
          <div><h2>知识观察</h2><p>{fullGraph.nodes.length} 个节点 · {fullGraph.edges.length} 条关系{unresolvedCount ? ` · ${unresolvedCount} 条待处理链接` : ''}{pendingSuggestions.length ? ` · ${pendingSuggestions.length} 条待确认建议` : ''}</p><small className="knowledge-graph-subtitle">仅显示可回查的显式链接、来源、标签和文件夹关系</small></div>
        </div>
        <div className="knowledge-graph-header-actions">
          <button type="button" className={localMode ? 'is-active' : ''} aria-pressed={localMode} onClick={toggleLocalMode}><LocateFixed size={15}/>{localMode ? '局部图谱' : '全库图谱'}</button>
          <button type="button" onClick={() => onOpenEvidenceWorkbench?.((selectedNode?.type === 'document' || selectedNode?.type === 'note') ? [selectedNode.sourceId] : [])}><BookOpenCheck size={15}/>证据工作台</button>
          {onClose && <button type="button" className="knowledge-graph-close" aria-label="关闭知识图谱" onClick={onClose}><X size={18}/></button>}
        </div>
      </header>

      <div className="knowledge-graph-toolbar">
        <label className="knowledge-graph-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文档、笔记或标签" aria-label="搜索图谱节点"/>{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13}/></button>}</label>
        <button type="button" className="knowledge-graph-mirror" title="选择 Markdown 文件夹并同步" onClick={syncMarkdownMirror}><FolderTree size={14}/>Markdown</button>
        {mirrorStatus && <span className="knowledge-graph-mirror-status" title={mirrorStatus}>{mirrorStatus}</span>}
        <div className="knowledge-graph-filters" aria-label="图谱过滤器">
          <button type="button" aria-pressed={filters.showDocuments} className={filters.showDocuments ? 'is-active document' : ''} onClick={() => toggleFilter('showDocuments')}><FileText size={13}/>文档 <span>{counts.document || 0}</span></button>
          <button type="button" aria-pressed={filters.showNotes} className={filters.showNotes ? 'is-active note' : ''} onClick={() => toggleFilter('showNotes')}><NotebookPen size={13}/>笔记 <span>{counts.note || 0}</span></button>
          <button type="button" aria-pressed={filters.showTags} className={filters.showTags ? 'is-active tag' : ''} onClick={() => toggleFilter('showTags')}><Tag size={13}/>标签 <span>{counts.tag || 0}</span></button>
          <button type="button" aria-pressed={filters.showUnresolved} className={filters.showUnresolved ? 'is-active' : ''} onClick={() => toggleFilter('showUnresolved')}><CircleDot size={13}/>未解析 <span>{counts.unresolved || 0}</span></button>
          <button type="button" aria-pressed={filters.showOrphans} className={filters.showOrphans ? 'is-active' : ''} onClick={() => toggleFilter('showOrphans')}><CircleDot size={13}/>孤立节点</button>
          <button type="button" aria-pressed={showArrows} className={showArrows ? 'is-active' : ''} onClick={() => setShowArrows(current => !current)}><ArrowRight size={13}/>方向箭头</button>
        </div>
        {localMode && <label className="knowledge-graph-jumps">范围<select value={localJumps} onChange={event => setLocalJumps(Number(event.target.value))} aria-label="局部图谱跳数"><option value={1}>1 跳</option><option value={2}>2 跳</option><option value={3}>3 跳</option></select></label>}
      </div>

      <div className={'knowledge-graph-workspace' + (selectedNode || fullGraph.nodes.length ? ' has-inspector' : '')}>
        <div className="knowledge-graph-stage">
          <div className="knowledge-graph-zoom" aria-label="图谱视图控制">
            <button type="button" aria-label="放大" onClick={() => zoomBy(1.2)}><ZoomIn size={16}/></button>
            <button type="button" aria-label="缩小" onClick={() => zoomBy(0.82)}><ZoomOut size={16}/></button>
            <button type="button" aria-label="适应画布" onClick={resetView}><Maximize2 size={15}/></button>
          </div>
          <SigmaGraphCanvas graph={visibleGraph} positions={positions} selectedNodeId={selectedNodeId} showArrows={showArrows} onActivate={nodeId => {
            const node = visibleGraph.nodes.find(item => item.id === nodeId);
            if (node) activateNode(node);
          }} onOpen={nodeId => {
            const node = visibleGraph.nodes.find(item => item.id === nodeId);
            if (node) openSelectedNode(node);
          }}/>
          <svg ref={svgRef} className="knowledge-graph-canvas" viewBox={'0 0 ' + GRAPH_VIEWBOX.width + ' ' + GRAPH_VIEWBOX.height} role="img"
            aria-label={'知识关系图，当前显示 ' + visibleGraph.nodes.length + ' 个节点和 ' + visibleGraph.edges.length + ' 条关系'}
            onWheel={handleWheel} onPointerDown={handleCanvasPointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>
              <filter id={markerId + '-shadow'} x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.18"/></filter>
            </defs>
            <g transform={'translate(' + viewport.x + ' ' + viewport.y + ') scale(' + viewport.scale + ')'}>
              <g className="knowledge-graph-edges">
                {visibleGraph.edges.map(edge => {
                  const from = positions[edge.from], to = positions[edge.to];
                  if (!from || !to) return null;
                  return <line key={edge.id} className={'knowledge-graph-edge is-' + edge.type + (edge.resolved ? '' : ' is-unresolved')} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    strokeWidth={Math.min(4, 1 + Math.log2(1 + edge.weight))} markerEnd={showArrows && edge.directed ? 'url(#' + markerId + ')' : undefined}><title>{edge.label || edgeLabel(edge.type)}</title></line>;
                })}
              </g>
              <g className="knowledge-graph-nodes">
                {visibleGraph.nodes.map(node => {
                  const position = positions[node.id];
                  if (!position) return null;
                  const radius = nodeRadius(node), selected = node.id === selectedNodeId;
                  const labelVisible = selected || node.isLocalRoot || visibleLabelIds.has(node.id);
                  return <g key={node.id} data-graph-node="true" data-node-id={node.id}
                    className={'knowledge-graph-node is-' + node.type + (selected ? ' is-selected' : '') + (node.isLocalRoot ? ' is-local-root' : '') + (node.degree > 4 ? ' is-high-degree' : '')}
                    transform={'translate(' + position.x + ' ' + position.y + ')'} role="button" tabIndex="0"
                    aria-label={typeLabel(node.type) + '：' + node.label + '，' + node.degree + ' 条关系'}
                    onPointerDown={event => handleNodePointerDown(event, node.id)} onClick={() => activateNode(node)}
                    onDoubleClick={() => openSelectedNode(node)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateNode(node); } }}>
                    {selected && <circle className="knowledge-graph-node-ring" r={radius + 7}/>}
                    {node.isLocalRoot && <circle className="knowledge-graph-node-focus" r={radius + 12}/>}
                    <circle className="knowledge-graph-node-dot" r={radius} fill={node.color} filter={'url(#' + markerId + '-shadow)'}/>
                    <text className={'knowledge-graph-node-label' + (labelVisible ? ' is-visible' : '')} y={radius + 17} textAnchor="middle">{node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label}</text>
                    <title>{node.label} · {typeLabel(node.type)} · {node.degree} 条关系</title>
                  </g>;
                })}
              </g>
            </g>
          </svg>
          {!visibleGraph.nodes.length && <div className="knowledge-graph-empty" role={loading ? 'status' : undefined}><Network size={34}/><b>{loading ? '正在加载已索引的知识关系' : '当前过滤条件下没有节点'}</b><span>{loading ? '图谱只展示可回查的显式链接、来源、标签和文件夹关系。' : '清空搜索或重新打开节点类型即可继续浏览。'}</span></div>}
          <div className="knowledge-graph-legend" aria-label="节点图例"><span><i className="document"/>文档</span><span><i className="note"/>笔记</span><span><i className="tag"/>标签</span><span><i className="unresolved"/>未解析</span></div>
        </div>

        {!selectedNode && fullGraph.nodes.length > 0 && <GraphRelationOverview relations={relationSummary} suggestions={pendingSuggestions} suggestionLabel={suggestionLabel} onConfirmSuggestion={onConfirmSuggestion} onSelect={nodeId => { setSelectedNodeId(nodeId); setSelectedRelation(null); }}/>}
        {selectedNode && <aside className="knowledge-graph-inspector" aria-label="关系侧栏">
          <div className="knowledge-graph-inspector-head">
            <span className={'knowledge-graph-inspector-icon is-' + selectedNode.type}><NodeTypeIcon type={selectedNode.type} size={17}/></span>
            <div><small>{typeLabel(selectedNode.type)}</small><h3>{selectedNode.label}</h3></div>
            <button type="button" aria-label="关闭关系侧栏" onClick={() => setSelectedNodeId('')}><X size={16}/></button>
          </div>
          {selectedNode.tags?.length > 0 && <div className="knowledge-graph-inspector-tags">{selectedNode.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
<div className="knowledge-graph-inspector-stats"><span><b>{selectedNode.degree}</b>关系</span><span><b>{relations.incoming.length}</b>反向</span><span><b>{relations.outgoing.length}</b>出向</span></div>
          <GraphSuggestionList suggestions={visibleSuggestions(selectedNode)} suggestionLabel={suggestionLabel} onConfirmSuggestion={onConfirmSuggestion}/>
          {(relations.incoming.length || relations.outgoing.length) ? <section className="knowledge-graph-relation-summary"><h4>关系说明</h4>{[...relations.outgoing.map(row => ({ ...row, direction: '出向' })), ...relations.incoming.map(row => ({ ...row, direction: '反向' }))].slice(0, 6).map(({ edge, node, direction }, index) => <div key={`summary-${edge.id}-${index}`}><b>{direction} · {node.label}</b><span>{edge.label || edgeLabel(edge.type)}</span></div>)}</section> : null}
          {(selectedNode.type === 'document' || selectedNode.type === 'note') && <div className="knowledge-graph-inspector-actions"><button type="button" className="knowledge-graph-open" onClick={() => openKnowledgeGraphNode(selectedNode, { onOpenDocument, onOpenNote, anchor: relationAnchorFor(selectedNode, selectedRelation), evidence: relationEvidenceFor(selectedRelation) })}><Focus size={15}/>打开{typeLabel(selectedNode.type)}</button>{selectedNode.type === 'document' && <button type="button" className="knowledge-graph-note" onClick={() => onCreateNote?.(selectedNode)}><MessageSquarePlus size={15}/>形成笔记</button>}</div>}
          {(selectedNode.type === 'document' || selectedNode.type === 'note') && <section className="knowledge-graph-ai-observation"><h4><Sparkles size={14}/>AI 观察</h4><p>围绕当前节点和相邻知识直接继续。</p><div>{observationQuestions.map(question => <button type="button" key={question.id} onClick={() => onAskNode?.(question.prompt, selectedNode, relatedNodes)}>{question.label}<ArrowRight size={12}/></button>)}</div></section>}
                    <RelationGroup title="链接到 / 来源" rows={relations.outgoing} onSelect={selectRelated}/>
          <RelationGroup title="反向链接" rows={relations.incoming} onSelect={selectRelated}/>
          {!relations.incoming.length && !relations.outgoing.length && <div className="knowledge-graph-no-relations"><Link2 size={20}/><span>这是一个孤立节点，暂时没有可展示的关系。</span></div>}
        </aside>}
      </div>
    </section>
  );
}

function writeSigmaGraphHits(container, renderer) {
  if (!container || !renderer) return;
  const hits = {};
  renderer.getGraph().forEachNode((nodeId, attributes) => {
    const display = renderer.getNodeDisplayData(nodeId);
    if (!display) return;
    const point = renderer.framedGraphToViewport({ x: display.x, y: display.y });
    hits[nodeId] = {
      x: Math.round(point.x),
      y: Math.round(point.y),
      label: attributes.label || '',
      type: attributes.nodeType || ''
    };
  });
  container.dataset.graphHits = JSON.stringify(hits);
}

function applySigmaSelection(renderer, container, nodeId) {
  if (!renderer) return;
  renderer.setSetting('nodeReducer', (id, attributes) => ({
    ...attributes,
    zIndex: id === nodeId ? 2 : 1,
    highlighted: id === nodeId
  }));
  if (container) container.dataset.selectedNodeId = nodeId || '';
  writeSigmaGraphHits(container, renderer);
}

function SigmaGraphCanvas({ graph, positions, selectedNodeId, showArrows, onActivate, onOpen }) {
  const containerRef = useRef(null);
  const activateRef = useRef(onActivate);
  const openRef = useRef(onOpen);
  const rendererRef = useRef(null);
  const selectedRef = useRef(selectedNodeId);
  activateRef.current = onActivate;
  openRef.current = onOpen;
  selectedRef.current = selectedNodeId;
  const structureKey = useMemo(() => [
    ...(graph.nodes || []).map(node => `${node.id}:${positions[node.id]?.x || 0}:${positions[node.id]?.y || 0}`),
    ...(graph.edges || []).map(edge => `${edge.id}:${edge.from}:${edge.to}:${edge.type}:${showArrows ? 'arrows' : 'plain'}`)
  ].join('|'), [graph, positions, showArrows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined' || !graph.nodes?.length) return undefined;
    let disposed = false;
    let renderer = null;
    let observer = null;
    let network = null;
    let sizeFrame = 0;
    const waitForSize = () => new Promise(resolve => {
      const startedAt = Date.now();
      const check = () => {
        if (disposed || graphContainerHasSize(container) || Date.now() - startedAt >= 5000) {
          resolve(!disposed && graphContainerHasSize(container));
          return;
        }
        sizeFrame = requestAnimationFrame(check);
      };
      check();
    });
    const start = async () => {
      try {
        const [graphologyModule, sigmaModule] = await Promise.all([import('graphology'), import('sigma')]);
        if (disposed || !container || !(await waitForSize())) return;
        const Graph = graphologyModule.default || graphologyModule.Graph;
        const Sigma = sigmaModule.default || sigmaModule.Sigma;
        if (!Graph || !Sigma) return;
        network = new Graph({ type: 'mixed', multi: true, allowSelfLoops: false });
        for (const node of graph.nodes) {
          const position = positions[node.id] || { x: 0, y: 0 };
          network.addNode(node.id, {
            x: position.x,
            y: position.y,
            size: Math.max(4, Math.min(16, 5 + Math.sqrt(Number(node.degree) || 0) * 2)),
            label: node.label,
            color: node.color || NODE_COLORS[node.type] || NODE_COLORS.document,
            nodeType: node.type,
            zIndex: node.id === selectedRef.current ? 2 : 1
          });
        }
        for (const edge of graph.edges) {
          if (!network.hasNode(edge.from) || !network.hasNode(edge.to)) continue;
          const attributes = {
            size: edge.type === 'suggestion' ? 2 : Math.min(4, 1 + Math.log2(1 + (edge.weight || 1))),
            color: edge.type === 'source' ? '#4d9b78' : edge.type === 'tag' ? '#cb913e' : edge.type === 'suggestion' ? '#c66eaa' : '#b2ada0',
            label: edge.label || edgeLabel(edge.type),
            type: showArrows && edge.directed ? 'arrow' : 'line'
          };
          if (edge.directed) network.addDirectedEdgeWithKey(edge.id, edge.from, edge.to, attributes);
          else network.addUndirectedEdgeWithKey(edge.id, edge.from, edge.to, attributes);
        }
        renderer = new Sigma(network, container, {
          renderEdgeLabels: false,
          renderLabels: graph.nodes.length <= 34,
          labelRenderedSizeThreshold: 7,
          labelFont: 'Segoe UI, sans-serif',
          labelColor: { color: '#524f45' },
          zIndex: true,
          stagePadding: 38,
          defaultEdgeType: 'line'
        });
        renderer.on('clickNode', ({ node }) => activateRef.current?.(node));
        renderer.on('doubleClickNode', ({ node, preventSigmaDefault }) => {
          preventSigmaDefault?.();
          openRef.current?.(node);
        });
        applySigmaSelection(renderer, container, selectedRef.current);
        renderer.getCamera().on('updated', () => writeSigmaGraphHits(container, renderer));
        container.parentElement?.classList.add('has-sigma');
        rendererRef.current = renderer;
        observer = new ResizeObserver(() => {
          if (graphContainerHasSize(container)) renderer?.refresh();
          writeSigmaGraphHits(container, renderer);
        });
        observer.observe(container);
      } catch {
        // The SVG compatibility layer remains available if WebGL is unavailable.
      }
    };
    void start();
    return () => {
      disposed = true;
      if (sizeFrame) cancelAnimationFrame(sizeFrame);
      observer?.disconnect();
      container?.parentElement?.classList.remove('has-sigma');
      delete container?.dataset.graphHits;
      delete container?.dataset.selectedNodeId;
      if (rendererRef.current === renderer) rendererRef.current = null;
      renderer?.kill();
      network?.clear();
    };
  }, [structureKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    applySigmaSelection(rendererRef.current, containerRef.current, selectedNodeId);
  }, [selectedNodeId]);

  return <div ref={containerRef} className="knowledge-graph-sigma" data-graph-renderer="sigma" aria-label="知识图谱 WebGL 画布" />;
}

function GraphSuggestionList({ suggestions = [], suggestionLabel, onConfirmSuggestion }) {
  if (!suggestions.length) return null;
  return <section className="knowledge-graph-suggestions" aria-label="待确认关系">
    <h4>待确认关系</h4>
    <div>{suggestions.map(item => <div key={item.id}>
      <p>{suggestionLabel?.(item.sourceNodeId) || item.sourceNodeId} → {suggestionLabel?.(item.targetNodeId) || item.targetNodeId}</p>
      {item.reason ? <p>{item.reason}</p> : null}
      <button type="button" onClick={() => onConfirmSuggestion?.(item.id, true)}>确认写入图谱</button>
      <button type="button" onClick={() => onConfirmSuggestion?.(item.id, false)}>忽略</button>
    </div>)}</div>
  </section>;
}

function GraphRelationOverview({ relations, suggestions = [], suggestionLabel, onConfirmSuggestion, onSelect }) {
  return <aside className="knowledge-graph-overview" aria-label="关系概览">
    <header><div><small>RELATION INDEX</small><h3>关系概览</h3><p>先看清谁和谁有关，再打开节点查看来源。</p></div><b>{relations.length}</b></header>
    <GraphSuggestionList suggestions={suggestions} suggestionLabel={suggestionLabel} onConfirmSuggestion={onConfirmSuggestion}/>
    {relations.length ? <div className="knowledge-graph-overview-list">{relations.map(relation => <button type="button" key={relation.id} onClick={() => onSelect?.(relation.fromId)}>
      <span className={'knowledge-graph-overview-icon is-' + relation.type}><Link2 size={13}/></span>
      <span className="knowledge-graph-overview-copy"><b>{relation.fromLabel}</b><small>{relation.label}</small><b>{relation.toLabel}</b></span>
      <ArrowRight size={14}/>
    </button>)}</div> : <div className="knowledge-graph-overview-empty"><Network size={22}/><b>目前没有已确认的文档关系</b><p>图谱不会凭空连线。添加 [[Wiki 链接]]、标签或内容中重复的明确主题后，这里会显示关系理由。</p></div>}
    <footer>主图仅显示可回查的显式链接、来源、标签和文件夹关系。</footer>
  </aside>;
}

function RelationGroup({ title, rows, onSelect }) {
  if (!rows.length) return null;
  return <section className="knowledge-graph-relation-group"><h4>{title}<span>{rows.length}</span></h4><div>{rows.map(({ edge, node }, index) => <button type="button" key={edge.id + ':' + node.id + ':' + index} onClick={() => onSelect(node, edge)}><span className={'knowledge-graph-relation-icon is-' + node.type}><NodeTypeIcon type={node.type} size={13}/></span><span><b>{node.label}</b><small>{edge.label || edgeLabel(edge.type)} · {typeLabel(node.type)}</small></span><ArrowRight size={13}/></button>)}</div></section>;
}

export default KnowledgeGraph;
