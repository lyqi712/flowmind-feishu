/**
 * 知识推理引擎 - 语义理解、关系推理、对比分析、矛盾检测
 * Knowledge Reasoning Engine: Deep understanding and inference
 */

/**
 * 语义相似度计算（简化版，实际可用向量距离）
 */
function semanticSimilarity(text1, text2) {
  const normalize = (text) => String(text || '').toLowerCase().trim();
  const t1 = normalize(text1);
  const t2 = normalize(text2);
  
  if (t1 === t2) return 1.0;
  if (!t1 || !t2) return 0.0;
  
  // 简单的词重叠度
  const words1 = new Set(t1.split(/\s+/));
  const words2 = new Set(t2.split(/\s+/));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0.0;
}

/**
 * 提取关键概念
 */
function extractConcepts(text) {
  const content = String(text || '').trim();
  
  // 提取名词短语（简化版，实际可用 NLP）
  const concepts = [];
  
  // 提取《》中的标题
  const titlePattern = /《([^》]+)》/gu;
  let match;
  while ((match = titlePattern.exec(content)) !== null) {
    concepts.push({
      type: 'title',
      text: match[1],
      position: match.index
    });
  }
  
  // 提取"的"字结构
  const dePattern = /([^\s，。！？；：,.\-]{2,8})的([^\s，。！？；：,.\-]{2,8})/gu;
  while ((match = dePattern.exec(content)) !== null) {
    concepts.push({
      type: 'relation',
      subject: match[1],
      object: match[2],
      text: match[0],
      position: match.index
    });
  }
  
  // 提取专业术语（2-6个字的名词）
  const termPattern = /(?:^|[\s，。；：])((?:[A-Z][a-z]+|[A-Z]+|[\u4e00-\u9fa5]{2,6}))(?=[\s，。；：！？]|$)/gu;
  while ((match = termPattern.exec(content)) !== null) {
    const term = match[1].trim();
    if (term.length >= 2) {
      concepts.push({
        type: 'term',
        text: term,
        position: match.index
      });
    }
  }
  
  return concepts;
}

/**
 * 构建概念图谱
 */
function buildConceptGraph(documents = []) {
  const graph = {
    nodes: new Map(),
    edges: []
  };
  
  for (const doc of documents) {
    const concepts = extractConcepts(doc.content);
    
    for (const concept of concepts) {
      const key = concept.text.toLowerCase();
      
      if (!graph.nodes.has(key)) {
        graph.nodes.set(key, {
          text: concept.text,
          type: concept.type,
          documents: new Set(),
          frequency: 0
        });
      }
      
      const node = graph.nodes.get(key);
      node.documents.add(doc.id);
      node.frequency++;
      
      // 对于关系型概念，建立边
      if (concept.type === 'relation' && concept.subject && concept.object) {
        graph.edges.push({
          from: concept.subject.toLowerCase(),
          to: concept.object.toLowerCase(),
          type: 'has_property',
          document: doc.id
        });
      }
    }
  }
  
  return graph;
}

/**
 * 查找概念之间的路径（推理链）
 */
function findConceptPath(graph, from, to, maxDepth = 3) {
  const fromKey = from.toLowerCase();
  const toKey = to.toLowerCase();
  
  if (fromKey === toKey) return [[fromKey]];
  if (!graph.nodes.has(fromKey) || !graph.nodes.has(toKey)) return [];
  
  const visited = new Set();
  const paths = [];
  
  function dfs(current, target, path, depth) {
    if (depth > maxDepth) return;
    if (current === target) {
      paths.push([...path]);
      return;
    }
    
    visited.add(current);
    
    // 查找相关边
    for (const edge of graph.edges) {
      if (edge.from === current && !visited.has(edge.to)) {
        dfs(edge.to, target, [...path, edge.to], depth + 1);
      }
    }
    
    visited.delete(current);
  }
  
  dfs(fromKey, toKey, [fromKey], 0);
  return paths;
}

/**
 * 检测概念之间的关系
 */
function inferRelationship(concept1, concept2, documents = []) {
  const graph = buildConceptGraph(documents);
  const paths = findConceptPath(graph, concept1, concept2);
  
  if (paths.length === 0) {
    // 检查语义相似度
    const similarity = semanticSimilarity(concept1, concept2);
    if (similarity > 0.7) {
      return {
        type: 'similar',
        confidence: similarity,
        evidence: []
      };
    }
    return {
      type: 'unrelated',
      confidence: 0.8,
      evidence: []
    };
  }
  
  // 找到连接路径
  return {
    type: 'connected',
    confidence: 0.9,
    paths: paths.map(p => p.join(' → ')),
    evidence: []
  };
}

/**
 * 对比分析：找出异同
 */
export function compareEntities(entity1, entity2, documents = []) {
  const concepts1 = extractConcepts(entity1.content || entity1);
  const concepts2 = extractConcepts(entity2.content || entity2);
  
  const set1 = new Set(concepts1.map(c => c.text.toLowerCase()));
  const set2 = new Set(concepts2.map(c => c.text.toLowerCase()));
  
  const common = new Set([...set1].filter(c => set2.has(c)));
  const unique1 = new Set([...set1].filter(c => !set2.has(c)));
  const unique2 = new Set([...set2].filter(c => !set1.has(c)));
  
  return {
    similarities: Array.from(common),
    differences: {
      onlyInFirst: Array.from(unique1),
      onlyInSecond: Array.from(unique2)
    },
    similarity: set1.size + set2.size > 0 
      ? (2 * common.size) / (set1.size + set2.size)
      : 0
  };
}

/**
 * 矛盾检测：找出冲突的陈述
 */
export function detectContradictions(statements = []) {
  const contradictions = [];
  
  // 对立关系词
  const opposites = [
    ['是', '不是'],
    ['有', '没有'],
    ['能', '不能'],
    ['会', '不会'],
    ['可以', '不可以'],
    ['支持', '不支持'],
    ['允许', '禁止'],
    ['增加', '减少'],
    ['上升', '下降'],
    ['成功', '失败']
  ];
  
  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const s1 = String(statements[i].content || statements[i]).trim();
      const s2 = String(statements[j].content || statements[j]).trim();
      
      // 检查是否讨论同一主题
      const similarity = semanticSimilarity(s1, s2);
      if (similarity < 0.4) continue; // 主题不相关，跳过
      
      // 检查是否包含对立词
      let hasOpposite = false;
      for (const [word1, word2] of opposites) {
        if ((s1.includes(word1) && s2.includes(word2)) ||
            (s1.includes(word2) && s2.includes(word1))) {
          hasOpposite = true;
          break;
        }
      }
      
      if (hasOpposite) {
        contradictions.push({
          statement1: statements[i],
          statement2: statements[j],
          type: 'logical_opposite',
          confidence: 0.8
        });
      }
    }
  }
  
  return contradictions;
}

/**
 * 推理链生成：从前提推导结论
 */
export function generateReasoningChain(premise, conclusion, context = {}) {
  const steps = [];
  
  // 第一步：理解前提
  steps.push({
    type: 'understand',
    description: '理解前提条件',
    content: premise,
    confidence: 0.95
  });
  
  // 第二步：检索相关知识
  const concepts = extractConcepts(premise);
  if (concepts.length > 0) {
    steps.push({
      type: 'retrieve',
      description: '检索相关知识',
      concepts: concepts.map(c => c.text),
      confidence: 0.85
    });
  }
  
  // 第三步：推理连接
  if (context.documents && context.documents.length > 0) {
    const graph = buildConceptGraph(context.documents);
    const premiseConcepts = concepts.map(c => c.text);
    const conclusionConcepts = extractConcepts(conclusion).map(c => c.text);
    
    // 尝试找到连接路径
    for (const pc of premiseConcepts) {
      for (const cc of conclusionConcepts) {
        const paths = findConceptPath(graph, pc, cc, 3);
        if (paths.length > 0) {
          steps.push({
            type: 'infer',
            description: '建立推理连接',
            path: paths[0].join(' → '),
            confidence: 0.75
          });
          break;
        }
      }
      if (steps.some(s => s.type === 'infer')) break;
    }
  }
  
  // 第四步：得出结论
  steps.push({
    type: 'conclude',
    description: '得出结论',
    content: conclusion,
    confidence: steps.length >= 3 ? 0.8 : 0.6
  });
  
  return {
    steps,
    confidence: steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length
  };
}

/**
 * 深度理解：提取核心论点和支撑证据
 */
export function deepUnderstanding(content, options = {}) {
  const text = String(content || '').trim();
  
  // 提取主要观点（简化版：句子级）
  const sentences = text.split(/[。！？；]/u).filter(s => s.trim().length > 5);
  
  const claims = [];
  const evidence = [];
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    
    // 判断是观点还是证据
    if (/(?:认为|觉得|应该|必须|需要|建议|推荐)/u.test(trimmed)) {
      claims.push({
        type: 'claim',
        text: trimmed,
        confidence: 0.75
      });
    } else if (/(?:因为|由于|根据|数据显示|研究表明|证明)/u.test(trimmed)) {
      evidence.push({
        type: 'evidence',
        text: trimmed,
        confidence: 0.8
      });
    } else if (trimmed.length > 15) {
      // 较长的描述性句子，可能是支撑性信息
      evidence.push({
        type: 'support',
        text: trimmed,
        confidence: 0.6
      });
    }
  }
  
  // 提取关键概念
  const concepts = extractConcepts(text);
  
  return {
    claims,
    evidence,
    concepts: concepts.slice(0, 10), // 最多返回10个核心概念
    mainTopic: concepts.length > 0 ? concepts[0].text : null,
    complexity: sentences.length > 10 ? 'high' : sentences.length > 5 ? 'medium' : 'low'
  };
}

/**
 * 知识融合：合并多个来源的信息
 */
export function fuseKnowledge(sources = []) {
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];
  
  const allConcepts = new Map();
  const allClaims = [];
  const allEvidence = [];
  
  for (const source of sources) {
    const understanding = deepUnderstanding(source.content || source);
    
    // 合并概念（去重）
    for (const concept of understanding.concepts) {
      const key = concept.text.toLowerCase();
      if (!allConcepts.has(key)) {
        allConcepts.set(key, {
          text: concept.text,
          sources: []
        });
      }
      allConcepts.get(key).sources.push(source.id || 'unknown');
    }
    
    // 收集观点和证据
    allClaims.push(...understanding.claims.map(c => ({
      ...c,
      source: source.id || 'unknown'
    })));
    allEvidence.push(...understanding.evidence.map(e => ({
      ...e,
      source: source.id || 'unknown'
    })));
  }
  
  // 检测矛盾
  const contradictions = detectContradictions(allClaims);
  
  return {
    concepts: Array.from(allConcepts.values()),
    claims: allClaims,
    evidence: allEvidence,
    contradictions,
    sourceCount: sources.length,
    hasConflict: contradictions.length > 0
  };
}

/**
 * 主入口：推理引擎
 */
export class ReasoningEngine {
  constructor(options = {}) {
    this.documents = options.documents || [];
    this.graph = null;
  }
  
  setDocuments(documents) {
    this.documents = documents;
    this.graph = null; // 重置图谱，下次使用时重建
  }
  
  getGraph() {
    if (!this.graph) {
      this.graph = buildConceptGraph(this.documents);
    }
    return this.graph;
  }
  
  understand(content) {
    return deepUnderstanding(content);
  }
  
  compare(entity1, entity2) {
    return compareEntities(entity1, entity2, this.documents);
  }
  
  detectConflicts(statements) {
    return detectContradictions(statements);
  }
  
  reason(premise, conclusion) {
    return generateReasoningChain(premise, conclusion, {
      documents: this.documents
    });
  }
  
  fuse(sources) {
    return fuseKnowledge(sources);
  }
  
  findRelation(concept1, concept2) {
    return inferRelationship(concept1, concept2, this.documents);
  }
}

export {
  extractConcepts,
  buildConceptGraph,
  semanticSimilarity
};
