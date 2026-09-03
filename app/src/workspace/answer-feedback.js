export function buildAnswerFeedbackPayload({ conversationId, messageId, rating, issueType, comment } = {}) {
  const conversation = String(conversationId || '').trim();
  const message = String(messageId || '').trim();
  const value = rating === 'negative' ? 'negative' : rating === 'positive' ? 'positive' : '';
  return {
    conversationId: conversation,
    messageId: message,
    rating: value,
    issueType: value === 'negative' ? (String(issueType || '').trim() || null) : null,
    comment: String(comment || '').slice(0, 500),
    valid: Boolean(conversation && message && value)
  };
}
