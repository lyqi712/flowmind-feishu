function clean(value) {
  return String(value ?? '').trim();
}

export function findTextMatches(haystack, query, { limit = 80 } = {}) {
  const text = String(haystack ?? '');
  const needle = clean(query);
  if (!text || !needle) return [];
  const lower = text.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const matches = [];
  let from = 0;
  while (from < lower.length && matches.length < limit) {
    const index = lower.indexOf(target, from);
    if (index < 0) break;
    matches.push({
      start: index,
      end: index + needle.length,
      text: text.slice(index, index + needle.length)
    });
    from = index + Math.max(1, needle.length);
  }
  return matches;
}

export function annotationHighlightQuery(annotation) {
  return clean(annotation?.quote || annotation?.selector?.quote || annotation?.text);
}

export function readerAnnotationPayload(selection, { color = 'yellow', comment = '' } = {}) {
  const quote = clean(selection?.quote || selection?.text);
  if (!quote) return null;
  return {
    pageNumber: 1,
    quote,
    comment,
    color,
    anchor: clean(selection?.anchor) || 'root',
    selector: {
      kind: 'text-quote',
      quote,
      startOffset: Number.isFinite(Number(selection?.startOffset)) ? Number(selection.startOffset) : undefined,
      endOffset: Number.isFinite(Number(selection?.endOffset)) ? Number(selection.endOffset) : undefined
    }
  };
}

export function unwrapMarkedNodes(root, className) {
  if (!root?.querySelectorAll) return 0;
  const marks = [...root.querySelectorAll(`mark.${className}`)];
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize?.();
  }
  return marks.length;
}

export function wrapTextMatches(root, query, className, { limit = 80 } = {}) {
  unwrapMarkedNodes(root, className);
  const needle = clean(query);
  if (!root || !needle || typeof root.ownerDocument?.createElement !== 'function') return [];
  const document = root.ownerDocument;
  const walker = document.createTreeWalker?.(root, 4);
  const nodes = [];
  if (walker) {
    while (walker.nextNode()) {
      const value = walker.currentNode?.nodeValue;
      if (value && clean(value)) nodes.push(walker.currentNode);
    }
  }
  const hits = [];
  for (const node of nodes.reverse()) {
    const matches = findTextMatches(node.nodeValue || '', needle, { limit: limit - hits.length });
    for (const match of matches.reverse()) {
      if (hits.length >= limit) break;
      const range = document.createRange?.();
      if (!range || typeof range.setStart !== 'function') continue;
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      const mark = document.createElement('mark');
      mark.className = className;
      mark.dataset.readerMark = className;
      try {
        range.surroundContents(mark);
        hits.unshift(mark);
      } catch {
        // Split text nodes or existing marks can reject surroundContents; skip that hit.
      }
    }
  }
  return hits;
}
