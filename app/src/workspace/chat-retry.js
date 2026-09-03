function normalizedDocumentIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))];
}

function verifiedSelection(value) {
  if (!value?.documentId || !(value.quote || value.text)) return null;
  return value;
}

export function retryChatRequest(messages = [], failedMessage = null, fallback = {}) {
  const items = Array.isArray(messages) ? messages : [];
  const requested = failedMessage?.id ? items.find(item => item?.id === failedMessage.id) || failedMessage : failedMessage;
  const failed = requested?.role === 'assistant'
    ? requested
    : [...items].reverse().find(item => item?.role === 'assistant' && item?.error) || null;
  const requestedIndex = failed ? items.findIndex(item => item === failed || item?.id === failed.id) : -1;
  const failedIndex = requestedIndex >= 0 ? requestedIndex : items.length;
  const user = [...items.slice(0, failedIndex)].reverse().find(item => item?.role === 'user') || (failedMessage?.role === 'user' ? failedMessage : null);
  const prompt = String(user?.text || user?.content || '').trim();
  if (!prompt) return null;
  return {
    prompt,
    documentIds: normalizedDocumentIds(user?.documentIds || failed?.documentIds || fallback.documentIds || []),
    targetAssistantId: failed?.id || '',
    attachments: user?.attachments || failed?.attachments || fallback.attachments || null,
    mode: user?.mode || failed?.mode || failed?.agent?.mode || fallback.mode || 'auto',
    selection: verifiedSelection(user?.selection) || verifiedSelection(failed?.selection)
  };
}
