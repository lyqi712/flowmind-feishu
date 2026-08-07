import { makeExcerpt, searchDocuments, tokenize } from './retrieval.mjs';

export const SKILLS = Object.freeze([
  {
    id: 'summary',
    name: '总结',
    description: '提炼文档主题、关键要点与行动项',
    inputHint: '输入主题、问题或指定 documentIds',
    steps: ['选择材料', '提取要点', '生成总结']
  },
  {
    id: 'compare',
    name: '对比',
    description: '比较多份材料的共同点、差异与适用场景',
    inputHint: '输入对比主题，建议指定至少两个 documentIds',
    steps: ['选择材料', '建立对比维度', '输出差异矩阵']
  },
  {
    id: 'research-report',
    name: '研究报告',
    description: '基于知识库证据生成结构化研究报告',
    inputHint: '输入研究问题或主题',
    steps: ['检索证据', '综合分析', '生成研究报告']
  },
  {
    id: 'mind-map',
    name: '思维导图',
    description: '把当前材料解析为可展开、可回溯来源的结构化导图',
    inputHint: '输入希望重点理解的主题；留空则解析当前文档',
    steps: ['读取材料结构', '组织主题层级', '生成交互导图']
  },
  {
    id: 'quiz',
    name: '互动测验',
    description: '基于当前材料生成带答案、解释和引用的交互测验',
    inputHint: '输入测验重点或学习目标',
    steps: ['提取关键事实', '设计题目与干扰项', '生成交互测验']
  },
  {
    id: 'podcast',
    name: '播客',
    description: '将当前材料整理成可播放、可下载的中文播客音频',
    inputHint: '输入播客主题、听众或希望强调的内容',
    steps: ['选择材料', '生成播客讲稿', '合成音频文件']
  },
  {
    id: 'document-insight', name: '文档解读', description: '解释材料主旨、术语、风险与待确认问题',
    inputHint: '选择一篇或多篇材料并输入关注点', steps: ['读取材料', '识别结构与风险', '生成解读']
  },
  {
    id: 'smart-writing', name: '智能写作', description: '基于知识库证据生成文章、方案或说明',
    inputHint: '输入体裁、受众和写作目标', steps: ['理解写作目标', '组织证据与提纲', '生成初稿']
  },
  {
    id: 'action-items', name: '行动项提取', description: '提取负责人、动作、时间和依赖',
    inputHint: '可输入项目或会议主题', steps: ['定位任务语句', '补全执行字段', '生成行动清单']
  },
  {
    id: 'faq', name: 'FAQ 生成', description: '从知识材料生成可发布的常见问题',
    inputHint: '输入目标读者或产品主题', steps: ['发现高频主题', '生成问答对', '校验引用']
  },
  {
    id: 'timeline', name: '时间线', description: '整理事件、版本与决策的时间顺序',
    inputHint: '输入事件或项目名称', steps: ['识别时间表达', '合并事件', '生成时间线']
  }
]);

const SKILL_ALIASES = new Map([
  ['summary', 'summary'], ['总结', 'summary'],
  ['compare', 'compare'], ['comparison', 'compare'], ['对比', 'compare'],
  ['research-report', 'research-report'], ['research', 'research-report'], ['研究报告', 'research-report'],
  ['mind-map', 'mind-map'], ['mindmap', 'mind-map'], ['思维导图', 'mind-map'],
  ['quiz', 'quiz'], ['测验', 'quiz'], ['互动测验', 'quiz'],
  ['podcast', 'podcast'], ['audio-show', 'podcast'], ['播客', 'podcast'],
  ['document-insight', 'document-insight'], ['document', 'document-insight'], ['文档解读', 'document-insight'],
  ['smart-writing', 'smart-writing'], ['writing', 'smart-writing'], ['智能写作', 'smart-writing'],
  ['action-items', 'action-items'], ['actions', 'action-items'], ['行动项', 'action-items'],
  ['faq', 'faq'], ['常见问题', 'faq'], ['timeline', 'timeline'], ['时间线', 'timeline']
]);

export function resolveSkill(skillId) {
  const normalized = SKILL_ALIASES.get(String(skillId || '').trim().toLowerCase()) || SKILL_ALIASES.get(String(skillId || '').trim());
  return SKILLS.find((skill) => skill.id === normalized) || null;
}

function selectDocuments(documents, { documentIds = [], input = '', query = '', limit = 6 } = {}) {
  const ids = new Set(Array.isArray(documentIds) ? documentIds.map(String) : []);
  if (ids.size) return documents.filter((document) => ids.has(String(document.id))).slice(0, limit);
  const searchText = String(input || query).trim();
  if (searchText) {
    const matches = searchDocuments(documents, searchText, { limit });
    if (matches.length) return matches.map((match) => match.document);
  }
  return documents.slice(0, limit);
}

function references(documents) {
  return documents.map((document, index) => ({
    index: index + 1,
    documentId: document.id,
    nodeToken: document.nodeToken || null,
    title: document.title,
    url: document.url || null,
    excerpt: makeExcerpt(document, [])
  }));
}

function summarizeDocument(document) {
  const excerpt = makeExcerpt(document, [], 220);
  return `- **${document.title}**：${excerpt}`;
}

function summaryArtifact(documents, input) {
  const title = input ? `“${input}”材料总结` : '知识库材料总结';
  return {
    kind: 'markdown',
    title,
    content: [
      `# ${title}`,
      '',
      '## 核心内容',
      ...documents.map(summarizeDocument),
      '',
      '## 行动建议',
      '- 回到引用原文核验关键结论。',
      '- 对缺少时间、负责人或量化指标的事项补充上下文。'
    ].join('\n'),
    references: references(documents)
  };
}

function topTerms(document, max = 8) {
  const counts = new Map();
  for (const term of tokenize(`${document.title} ${document.content}`)) counts.set(term, (counts.get(term) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, max).map(([term]) => term);
}

function compareArtifact(documents, input) {
  const termSets = documents.map((document) => new Set(topTerms(document)));
  const common = termSets.length
    ? [...termSets[0]].filter((term) => termSets.slice(1).every((set) => set.has(term))).slice(0, 6)
    : [];
  const rows = documents.map((document, index) => {
    const uniqueTerms = [...termSets[index]].filter((term) => termSets.every((set, otherIndex) => otherIndex === index || !set.has(term))).slice(0, 5);
    return `| ${document.title} | ${makeExcerpt(document, [], 90).replace(/\|/g, '\\|')} | ${uniqueTerms.join('、') || '需结合原文判断'} |`;
  });
  return {
    kind: 'markdown',
    title: input ? `“${input}”对比分析` : '知识库材料对比',
    content: [
      `# ${input ? `“${input}”对比分析` : '知识库材料对比'}`,
      '',
      `## 共同点\n${common.length ? common.map((term) => `- ${term}`).join('\n') : '- 当前材料未出现稳定的共同高频主题。'}`,
      '',
      '## 差异矩阵',
      '| 材料 | 核心描述 | 区分词 |',
      '| --- | --- | --- |',
      ...rows,
      '',
      '## 结论',
      documents.length < 2 ? '- 当前只找到一份材料，补充至少一份文档后可形成有效横向对比。' : '- 各材料关注点不同，选用时应结合目标场景并核验引用原文。'
    ].join('\n'),
    references: references(documents)
  };
}

function reportArtifact(documents, input) {
  const topic = input || '知识库主题';
  return {
    kind: 'markdown',
    title: `${topic}研究报告`,
    content: [
      `# ${topic}研究报告`,
      '',
      '## 执行摘要',
      `本报告基于本地知识库中检索到的 ${documents.length} 份材料，围绕“${topic}”整理可核验结论。`,
      '',
      '## 关键发现',
      ...documents.map(summarizeDocument),
      '',
      '## 风险与限制',
      '- 结论仅覆盖当前已同步文档，可能缺少知识空间中的未授权或非 docx 内容。',
      '- 文档更新后需要重新同步，才能反映最新信息。',
      '',
      '## 建议',
      '- 优先复核高相关引用，并补齐缺失证据。',
      '- 将重要结论转化为含负责人和截止时间的行动项。',
      '',
      '## 引用',
      ...documents.map((document, index) => `${index + 1}. ${document.title}${document.url ? ` — ${document.url}` : ''}`)
    ].join('\n'),
    references: references(documents)
  };
}

function safeDocumentMetadata(document) {
  if (document?.metadata && typeof document.metadata === 'object') return document.metadata;
  try { return JSON.parse(document?.metadata || '{}'); } catch { return {}; }
}

function cleanMarkdownText(value, limit = 180) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:[-*+] |\d+[.)] |> ?)/gm, '')
    .replace(/[*_`~#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function headingAnchor(title) {
  return String(title || '').trim().toLowerCase().replace(/[^\p{Letter}\p{Number}\s_-]/gu, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'root';
}

function documentSections(document, max = 10) {
  const content = String(document?.content || document?.markdown || '');
  const metadata = safeDocumentMetadata(document);
  const outline = Array.isArray(metadata.outline) ? metadata.outline : [];
  const headingMatches = [...content.matchAll(/^(#{1,4})\s+(.+)$/gm)];
  const sections = headingMatches.map((match, index) => {
    const title = String(match[2] || '').replace(/[*_`]/g, '').trim();
    const nextOffset = headingMatches[index + 1]?.index ?? content.length;
    const bodyOffset = (match.index || 0) + match[0].length;
    const body = content.slice(bodyOffset, nextOffset);
    const outlineEntry = outline.find((entry) => String(entry?.title || '').trim() === title) || outline[index];
    const excerpt = cleanMarkdownText(body, 180) || cleanMarkdownText(match[0], 180);
    return {
      id: `${document.id || 'doc'}-section-${index + 1}`,
      label: title || `章节 ${index + 1}`,
      anchor: String(outlineEntry?.anchor || outlineEntry?.blockId || headingAnchor(title)),
      summary: excerpt,
      quote: excerpt,
      startOffset: bodyOffset,
      endOffset: nextOffset,
      documentId: document.id
    };
  }).filter((entry) => entry.label && entry.summary);
  if (sections.length) return sections.slice(0, max);

  const paragraphMatches = [...content.matchAll(/(?:^|\n\s*\n)([^#\n][\s\S]*?)(?=\n\s*\n|$)/g)]
    .map((match, index) => {
      const excerpt = cleanMarkdownText(match[1], 180);
      return excerpt ? {
        id: `${document.id || 'doc'}-paragraph-${index + 1}`,
        label: index === 0 ? '核心内容' : `要点 ${index + 1}`,
        anchor: 'root',
        summary: excerpt,
        quote: excerpt,
        startOffset: match.index || 0,
        endOffset: (match.index || 0) + match[0].length,
        documentId: document.id
      } : null;
    }).filter(Boolean);
  return paragraphMatches.slice(0, max);
}

function mindMapArtifact(documents, input) {
  const topic = input || documents[0]?.title || '当前材料';
  const branches = documents.slice(0, 6).map((document, documentIndex) => {
    const sections = documentSections(document, 10);
    const fallbackTerms = topTerms(document, 6).map((term, index) => ({
      id: `${document.id}-term-${index + 1}`, label: term, summary: `在《${document.title}》中定位“${term}”相关内容`,
      documentId: document.id, anchor: 'root', quote: term
    }));
    return {
      id: `branch-${document.id || documentIndex}`,
      label: document.title,
      summary: makeExcerpt(document, [], 180),
      documentId: document.id,
      anchor: 'root',
      children: sections.length ? sections : fallbackTerms
    };
  });
  return {
    kind: 'mind-map',
    title: `${topic}思维导图`,
    content: [`# ${topic}思维导图`, '', ...branches.map((branch) => `## ${branch.label}\n${branch.children.map((child) => `- **${child.label}**：${child.summary || ''}`).join('\n')}`)].join('\n'),
    tree: { id: 'root', label: topic, summary: `基于 ${documents.length} 份当前材料生成`, children: branches },
    references: references(documents)
  };
}

function quizArtifact(documents, input) {
  const topic = input || documents[0]?.title || '当前材料';
  const candidates = documents.flatMap((document) => documentSections(document, 6).map((section) => ({ document, section })));
  const fallbackCandidates = documents.map((document, index) => ({
    document,
    section: { id: `${document.id}-summary-${index + 1}`, label: '核心内容', anchor: 'root', summary: makeExcerpt(document, [], 170), quote: makeExcerpt(document, [], 170), documentId: document.id }
  }));
  const rows = (candidates.length ? candidates : fallbackCandidates).filter((row) => row.section.summary).slice(0, 6);
  const questions = rows.map(({ document, section }, index) => {
    const correct = cleanMarkdownText(section.summary, 150);
    const otherEvidence = rows.filter((_, otherIndex) => otherIndex !== index).map((row) => cleanMarkdownText(row.section.summary, 135)).filter((choice) => choice && choice !== correct);
    const distractorPool = [...new Set([
      ...otherEvidence,
      '当前材料没有给出这一结论，需要从其他来源补充证据。',
      '这一部分只描述背景，没有形成可核验的具体信息。',
      '该表述来自其他主题，不能作为本节内容的概括。'
    ])];
    const choices = distractorPool.slice(0, 3);
    const correctIndex = index % (choices.length + 1);
    choices.splice(correctIndex, 0, correct);
    const baseRef = references([document])[0];
    return {
      id: `question-${index + 1}`,
      prompt: `根据《${document.title}》的“${section.label}”，以下哪项表述与原文一致？`,
      choices,
      correctIndex,
      explanation: `原文“${section.label}”对应的关键信息是：${correct}`,
      sourceRef: {
        ...baseRef,
        anchor: section.anchor || 'root',
        quote: section.quote || correct,
        startOffset: section.startOffset,
        endOffset: section.endOffset
      }
    };
  });
  return {
    kind: 'quiz',
    title: `${topic}互动测验`,
    content: [`# ${topic}互动测验`, '', ...questions.map((question, index) => `## ${index + 1}. ${question.prompt}\n${question.choices.map((choice, choiceIndex) => `- ${choiceIndex === question.correctIndex ? '✓' : '○'} ${choice}`).join('\n')}\n\n${question.explanation}`)].join('\n'),
    questions,
    references: references(documents)
  };
}function podcastArtifact(documents, input) {
  const topic = input || '知识库主题';
  const evidence = documents.slice(0, 6).map((document, index) => `第 ${index + 1} 部分，${document.title}。${makeExcerpt(document, [], 420)}`).join('\n\n');
  return {
    kind: 'audio',
    title: `${topic}播客`,
    content: [
      `欢迎收听本期 FlowMind 知识播客。今天我们围绕${topic}，结合当前飞书知识库中的 ${documents.length} 份材料，梳理最值得关注的结论。`,
      '',
      evidence,
      '',
      '综合这些材料，可以先形成三点判断。第一，重要结论需要保留来源并回到原文核验。第二，材料之间如果存在版本或口径差异，应优先确认更新时间和正式发布渠道。第三，下一步应把结论转换为明确的负责人、截止时间和验收条件。',
      '',
      '以上内容来自当前已连接的飞书知识材料。感谢收听。'
    ].join('\n'),
    references: references(documents)
  };
}
function insightArtifact(documents, input) {
  return { kind: 'markdown', title: `${input || documents[0]?.title || '材料'}解读`, content: [
    `# ${input || documents[0]?.title || '材料'}解读`, '', '## 一句话主旨', makeExcerpt(documents[0], [], 260), '',
    '## 关键材料', ...documents.map(summarizeDocument), '', '## 风险与待确认',
    '- 文档中缺少明确数字、时间或责任主体的结论需要回到原文确认。',
    '- 多份材料存在版本差异时，以更新时间和正式发布渠道为准。', '',
    '## 可继续追问', '- 这份材料最重要的三个决策是什么？', '- 哪些结论缺少证据？', '- 应该立即执行哪些事项？'
  ].join('\n'), references: references(documents) };
}

function writingArtifact(documents, input) {
  const goal = input || '知识库主题说明';
  return { kind: 'markdown', title: `${goal}初稿`, content: [
    `# ${goal}`, '', '## 背景', `本文基于 ${documents.length} 份知识库材料整理，关键事实均可通过引用回溯。`, '',
    '## 正文', ...documents.map((document, index) => `### ${document.title}\n${makeExcerpt(document, [], 320)} [${index + 1}]`), '',
    '## 结论', '综合当前材料，应优先保持事实与来源一致，并在发布前确认受众、时间范围和责任边界。'
  ].join('\n'), references: references(documents) };
}

function actionArtifact(documents, input) {
  const rows = documents.map((document, index) => `| ${index + 1} | 复核并落实《${document.title}》中的关键事项 | 待指定 | 待指定 | [${index + 1}] |`);
  return { kind: 'markdown', title: `${input || '知识库'}行动项`, content: [
    `# ${input || '知识库'}行动项`, '', '| # | 行动 | 负责人 | 截止时间 | 来源 |', '|---:|---|---|---|---|', ...rows, '',
    '## 执行规则', '- 负责人和截止时间未在原文明确时保持“待指定”，不自动编造。', '- 完成前回到引用原文核验范围和验收条件。'
  ].join('\n'), references: references(documents) };
}

function faqArtifact(documents, input) {
  const items = documents.map((document, index) => `## Q${index + 1}：${document.title}讲了什么？\n${makeExcerpt(document, [], 260)} [${index + 1}]`);
  return { kind: 'markdown', title: `${input || '知识库'} FAQ`, content: [`# ${input || '知识库'} FAQ`, '', ...items, '', '## 找不到答案时', '请同步最新文档或缩小知识空间范围，不使用知识库之外的信息补齐事实。'].join('\n'), references: references(documents) };
}

function timelineArtifact(documents, input) {
  const sorted = documents.slice().sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
  return { kind: 'markdown', title: `${input || '知识库'}时间线`, content: [
    `# ${input || '知识库'}时间线`, '', ...sorted.map((document, index) => `- **${document.updatedAt ? new Date(document.updatedAt).toISOString().slice(0, 10) : '时间未标注'}** — ${document.title}：${makeExcerpt(document, [], 150)} [${index + 1}]`), '',
    '> 未包含明确时间的事件使用文档更新时间代替，并需要人工确认。'
  ].join('\n'), references: references(sorted) };
}
function skillModelInstructions(skill) {
  const instructions = {
    summary: '提炼主题、关键事实、结论和可执行行动项。',
    compare: '使用 Markdown 表格比较共同点、差异、适用场景和冲突证据。',
    'research-report': '生成包含执行摘要、关键发现、风险限制、建议和引用的研究报告。',
    'mind-map': '把材料组织为结论清晰、层级合理的主题树，并保留每个分支的来源。',
    quiz: '生成可交互的选择题，覆盖关键事实、结论和风险；每题必须给出答案、解释和来源。',
    podcast: '生成适合直接朗读的中文播客讲稿，不使用 Markdown 表格，句子自然、口语化，并明确材料依据。',
    'document-insight': '解释材料主旨、结构、术语、风险、矛盾和待确认问题。',
    'smart-writing': '按用户目标生成可直接编辑发布的成稿，并确保事实均可回溯到证据。',
    'action-items': '提取行动、负责人、截止时间、依赖和验收条件；原文没有的信息标为待指定。',
    faq: '生成面向目标读者的 FAQ；每个答案均给出证据引用。',
    timeline: '按时间顺序整理事件、版本和决策；区分明确日期与文档更新时间。'
  };
  return instructions[skill.id] || skill.description;
}

function skillEvidence(documents) {
  let remaining = 36000;
  return documents.map((document, index) => {
    const header = `[${index + 1}] ${document.title}\nURL: ${document.url || 'local'}\n`;
    const content = String(document.content || '').slice(0, Math.max(0, Math.min(7000, remaining - header.length)));
    remaining -= header.length + content.length;
    return `${header}${content}`;
  }).join('\n\n');
}

export async function* executeSkill(skillId, documents, input = {}, { modelService, signal } = {}) {
  const skill = resolveSkill(skillId);
  if (!skill) {
    const error = new Error(`未知 Skill: ${skillId}`);
    error.code = 'SKILL_NOT_FOUND';
    throw error;
  }
  const selected = selectDocuments(documents, input);
  const runId = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();

  yield { type: 'start', runId, skill, startedAt };
  yield { type: 'step', runId, step: 1, name: skill.steps[0], status: 'completed', detail: `选择了 ${selected.length} 份文档` };

  if (!selected.length) {
    const error = new Error('本地知识库没有可供 Skill 使用的文档，请先执行同步');
    error.code = 'KNOWLEDGE_BASE_EMPTY';
    throw error;
  }

  yield { type: 'step', runId, step: 2, name: skill.steps[1], status: 'completed', detail: '已提取主题、证据和文档差异' };

  const topic = String(input.input || input.query || '').trim();
  let artifact;
  if (skill.id === 'summary') artifact = summaryArtifact(selected, topic);
  else if (skill.id === 'compare') artifact = compareArtifact(selected, topic);
  else if (skill.id === 'research-report') artifact = reportArtifact(selected, topic);
  else if (skill.id === 'mind-map') artifact = mindMapArtifact(selected, topic);
  else if (skill.id === 'quiz') artifact = quizArtifact(selected, topic);
  else if (skill.id === 'podcast') artifact = podcastArtifact(selected, topic);
  else if (skill.id === 'document-insight') artifact = insightArtifact(selected, topic);
  else if (skill.id === 'smart-writing') artifact = writingArtifact(selected, topic);
  else if (skill.id === 'action-items') artifact = actionArtifact(selected, topic);
  else if (skill.id === 'faq') artifact = faqArtifact(selected, topic);
  else artifact = timelineArtifact(selected, topic);

  let model = { provider: 'local', id: 'local-skill-engine' };
  let fallbackUsed = false;
  if (modelService) {
    const settings = await modelService.publicSettings();
    if (settings.provider !== 'local') {
      model = { provider: settings.provider, id: settings.model };
      yield { type: 'model', runId, provider: settings.provider, model: settings.model, status: 'generating' };
      try {
        const chunks = [];
        let progressChunk = '';
        for await (const delta of modelService.streamGenerate({
          system: '你是企业知识库工作流引擎。只使用给定证据，输出简体中文 Markdown；保留 [1] 形式的引用编号；不得编造来源、负责人、日期或数字。',
          prompt: `Skill：${skill.name}\n目标：${skillModelInstructions(skill)}\n用户要求：${topic || '未额外指定'}\n\n知识库证据：\n${skillEvidence(selected)}\n\n请输出完整产物，不要解释生成过程。`,
          signal
        })) {
          chunks.push(delta);
          progressChunk += delta;
          if (progressChunk.length >= 64) {
            yield { type: 'model-delta', runId, delta: progressChunk };
            progressChunk = '';
          }
        }
        if (progressChunk) yield { type: 'model-delta', runId, delta: progressChunk };
        const generated = chunks.join('').trim();
        if (!generated) throw Object.assign(new Error('模型服务返回了空产物'), { code: 'MODEL_EMPTY_RESPONSE' });
        artifact = { ...artifact, content: generated, generatedBy: model };
      } catch (error) {
        if (!settings.fallbackToLocal) throw error;
        fallbackUsed = true;
        model = { provider: 'local', id: 'local-skill-engine' };
        yield { type: 'model-fallback', runId, target: 'local-skill-engine', error: { code: error.code || 'MODEL_FAILED', message: error.message || '模型生成失败' } };
      }
    }
  }

  const selection = input.selection && typeof input.selection === 'object' ? input.selection : null;
  const selectionDocumentId = selection?.documentId || selection?.sourceId || selection?.id || '';
  const selectionQuote = String(selection?.quote || selection?.text || '').trim();
  const sourceRefs = (artifact.sourceRefs || artifact.references || []).map((reference, index) => {
    if (!selectionQuote || (selectionDocumentId && String(reference.documentId) !== String(selectionDocumentId)) || (!selectionDocumentId && index > 0)) return reference;
    return {
      ...reference,
      selection: true,
      quote: selectionQuote,
      anchor: selection.anchor || reference.anchor || 'root',
      startOffset: Number.isFinite(Number(selection.startOffset)) ? Number(selection.startOffset) : undefined,
      endOffset: Number.isFinite(Number(selection.endOffset)) ? Number(selection.endOffset) : undefined
    };
  });
  const selectedRef = sourceRefs.find((reference) => reference.selection);
  const tree = selectedRef && artifact.tree ? {
    ...artifact.tree,
    children: (artifact.tree.children || []).map((branch) => String(branch.documentId) === String(selectedRef.documentId)
      ? { ...branch, selection: true, quote: selectedRef.quote, anchor: selectedRef.anchor, startOffset: selectedRef.startOffset, endOffset: selectedRef.endOffset }
      : branch)
  } : artifact.tree;
  const questions = Array.isArray(artifact.questions) ? artifact.questions.map((question) => {
    if (!selectedRef || String(question.sourceRef?.documentId) !== String(selectedRef.documentId)) return question;
    return { ...question, sourceRef: { ...question.sourceRef, ...selectedRef } };
  }) : artifact.questions;
  artifact = { ...artifact, sourceRefs, references: sourceRefs, ...(tree ? { tree } : {}), ...(questions ? { questions } : {}) };
  yield { type: 'step', runId, step: 3, name: skill.steps[2], status: 'completed', detail: `已生成《${artifact.title}》` };
  yield { type: 'artifact', runId, artifact, model, fallbackUsed };
  yield {
    type: 'done',
    runId,
    completedAt: new Date().toISOString(),
    result: { skillId: skill.id, documentIds: selected.map((document) => document.id), artifact, model, fallbackUsed }
  };
}
