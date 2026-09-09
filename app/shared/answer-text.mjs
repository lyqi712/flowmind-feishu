/** Shared answer shaping for chat, agent, and UI display. */

export function stripTemplatedAnswerSections(value) {
  return String(value ?? '')
    .replace(/^#{1,3}\s*(结论|依据|下一步|核心回答|简要回答|总结|核心差异|关键发现|执行摘要)\s*$/gim, '')
    .replace(/^#{1,3}\s*(缺口|覆盖率|引用覆盖率|未被引用覆盖|材料不均衡)[^\n]*$/gim, '')
    .replace(/^(?:引用覆盖率|材料不均衡|覆盖率约)[:：]?\s*[^\n]+$/gim, '')
    .replace(/^(?:缺乏直接证据|未被引用覆盖|以下结论缺乏)[:：]?\s*[^\n]+$/gim, '')
    .replace(/^(?:总的来说|综上所述|综上|简而言之|从以上分析可以看出|基于以上分析)[:：,，]?\s*/gim, '')
    .replace(/^(?:根据|基于)(?:以上|上述|现有)(?:材料|证据|资料)[:：,，]?\s*/gim, '')
    .replace(/^(?:已根据可见证据|根据检索结果)(?:完成|得到)[^\n。]*[。.]?\s*/gim, '')
    .replace(/^\d+\.\s*(?:结论|依据|下一步)[:：]\s*/gim, '')
    .replace(/^\*\*(?:总体而言|一句话总结|核心要点)\*\*\s*$/gim, '')
    .replace(/^\*\*关于[^\n*]{1,48}\*\*\s*$/gim, '')
    .replace(/^(?:核心区别在于|主要差异在于|两者的核心差异在于)[：:]?\s*/gm, '')
    .replace(/^(?:这两份|这几篇)材料(?:对.{0,48})?(?:的讲法)?差异很大[，。]?\s*(?:核心区别在于[：:]?\s*)?/gm, '')
    .replace(/^我主要看了[《「“].{0,120}(?:这两篇|这几篇).*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the answer still looks like a canned report skeleton after stripping. */
export function looksTemplatedAnswer(value) {
  const text = stripTemplatedAnswerSections(value);
  if (!text) return true;
  return /^(?:结论|依据|下一步)[:：]/m.test(text)
    || /引用覆盖率|材料不均衡|缺乏直接证据/.test(text)
    || /^#{1,3}\s*(?:结论|总结|执行摘要)/m.test(text);
}

export function citedDocumentIds(citations = []) {
  return new Set((Array.isArray(citations) ? citations : [])
    .map(item => String(item?.documentId || item?.id || '').trim())
    .filter(Boolean));
}

export function hasSubstantiveEvidenceAnalysis(relations) {
  if (!relations) return false;
  const documentIds = new Set((relations.relatedDocuments || []).map(item => String(item?.documentId || '')).filter(Boolean));
  return documentIds.size > 1 || (relations.conflicts || []).length > 0;
}

export function shouldAttachRelationsAnalysis(relations, citations = [], citationIntegrity = null) {
  if (!relations) return false;
  if (citationIntegrity?.status === 'downgraded' || (citationIntegrity?.invalidMarkers || []).length) return true;
  const intent = `${relations.intent?.type || ''} ${relations.intent?.label || ''} ${relations.rewrittenQuestion || ''}`;
  if (/(?:compare|relation|对比|比较|关系|联系)/i.test(intent)) return true;
  const cited = citedDocumentIds(citations);
  if (cited.size < 2 && !(relations.conflicts || []).length) return false;
  return true;
}
