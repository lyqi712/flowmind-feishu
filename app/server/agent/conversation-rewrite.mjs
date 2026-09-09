import { bindEvidenceRef } from '../evidence.mjs';
import { isTransformableAssistantAnswer } from '../retrieval-policy.mjs';

// References come only from a persisted assistant message, never a client handoff.
// Rewriting preserves the original version/anchor, including stale/unavailable state.
export function sourcesForAnswerRewrite({ store, registry, handoff, answer, allowedKnowledgeBaseIds = [] }) {
  const conversationId = String(handoff?.conversationId || '');
  if (!conversationId) return [];
  const conversation = store.getConversation?.(conversationId)
    || store.get().conversations?.find(item => String(item.id) === conversationId);
  if (!conversation) return [];
  const previous = [...(conversation.messages || [])].reverse().find(message => {
    if (message.role !== 'assistant') return false;
    return isTransformableAssistantAnswer(message.content ?? message.text, {
      retrievalPolicy: message.retrievalPolicy || message.agent?.retrievalPolicy,
      citationStatus: message.citationStatus || message.agent?.citationStatus,
      fastReply: message.fastReply,
      agent: message.agent
    });
  });
  const sourceText = String(previous?.content ?? previous?.text ?? '').trim();
  if (!sourceText || sourceText.slice(0, 4000) !== String(answer || '').trim()) return [];
  const refs = Array.isArray(previous.citations) ? previous.citations : previous.sourceRefs || [];
  const allowed = new Set(allowedKnowledgeBaseIds.map(String));
  const original = refs.slice(0, 24);
  const inherited = original.flatMap((ref, index) => {
    const id = String(ref?.documentId || ref?.contentItemId || '');
    if (!id) return [];
    const document = registry.getDocument(id, { includeDeleted: true });
    if (allowed.size && !allowed.has(String(document?.knowledgeBaseId || document?.spaceId || ''))) return [];
    return [{ ...bindEvidenceRef(ref, document), index: index + 1 }];
  });
  // Dropping a source would shift [n] onto a different document. Fail closed instead.
  return inherited.length === original.length ? inherited : [];
}
