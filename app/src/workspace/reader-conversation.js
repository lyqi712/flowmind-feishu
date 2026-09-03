function clean(value) {
  return String(value ?? '').trim();
}

function documentIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))];
}

export function readerConversationMatchesDocument(conversation, documentId) {
  const expected = clean(documentId);
  if (!conversation || !expected) return false;
  const boundDocument = clean(conversation.readerDocumentId);
  if (conversation.surface === 'reader' || boundDocument) return boundDocument === expected;
  const scope = documentIds(conversation.lastScope?.documentIds);
  return scope.length === 1 && scope[0] === expected;
}

export function readerMessagesFromConversation(conversation) {
  const rows = Array.isArray(conversation?.messages) ? conversation.messages : [];
  let latestQuestion = '';
  return rows.flatMap((message, index) => {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
    if (!role) return [];
    const text = String(message.content ?? message.text ?? '');
    if (role === 'user') latestQuestion = text;
    return [{
      ...message,
      id: clean(message.id) || `reader-restored-${index}`,
      role,
      text,
      question: role === 'assistant' ? clean(message.question) || latestQuestion : undefined,
      citations: Array.isArray(message.citations) ? message.citations : [],
      documentIds: documentIds(message.documentIds),
      selection: message.selection || null,
      done: role === 'assistant' ? Boolean(text) && !message.error : undefined,
      restored: true
    }];
  });
}

export function restoredReaderChat(conversation, documentId) {
  const id = clean(documentId);
  if (!readerConversationMatchesDocument(conversation, id)) return null;
  return {
    documentId: id,
    conversationId: clean(conversation.id),
    messages: readerMessagesFromConversation(conversation),
    streaming: false,
    error: ''
  };
}
