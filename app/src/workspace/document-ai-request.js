// Abort is best-effort: ownership checks also reject buffered events and late promises.
export function createDocumentAiRequestController() {
  let generation = 0;
  let active = null;
  function invalidate() {
    const previous = active;
    active = null;
    generation += 1;
    previous?.controller.abort();
  }
  return {
    invalidate,
    begin(documentId) {
      invalidate();
      if (!documentId) return null;
      const controller = new AbortController();
      active = { documentId: String(documentId), generation, controller, signal: controller.signal };
      return active;
    },
    isCurrent(token, documentId) {
      return Boolean(token && token === active && token.generation === generation
        && token.documentId === String(documentId || '') && !token.signal.aborted);
    }
  };
}
