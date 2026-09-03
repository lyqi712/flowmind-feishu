function citationMarker() {
  return /\[(\d+)\]/g;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))];
}

export function extractCitationMarkers(answer) {
  return [...String(answer || '').matchAll(citationMarker())].map((match) => Number(match[1]));
}

export function invalidCitationMarkers(answer, count) {
  const limit = Number(count || 0);
  return extractCitationMarkers(answer).filter((value) => !Number.isInteger(value) || value < 1 || value > limit);
}

export function partitionCitationMarkers(answer, evidenceCount) {
  const limit = Number(evidenceCount || 0);
  const valid = [];
  const invalid = [];
  for (const value of extractCitationMarkers(answer)) {
    if (Number.isInteger(value) && value >= 1 && value <= limit) valid.push(value);
    else invalid.push(value);
  }
  return { valid: uniqueNumbers(valid), invalid: uniqueNumbers(invalid) };
}

export function stripInvalidCitationMarkers(answer, evidenceCount) {
  const limit = Number(evidenceCount || 0);
  return String(answer || '')
    .replace(citationMarker(), (full, raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 1 && value <= limit ? full : '';
    })
    .replace(/\s+(?=[。．.！？!?，,；;])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

export function claimsWithInvalidCitations(answer, invalidMarkers = []) {
  const wanted = new Set((invalidMarkers || []).filter((value) => Number.isInteger(value)));
  if (!wanted.size) return [];
  return String(answer || '')
    .split(/(?<=[。．.！？!?])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && [...sentence.matchAll(citationMarker())].some((match) => wanted.has(Number(match[1]))));
}

export function bindAnswerCitations(answer, citations = [], { keepUncited = false } = {}) {
  const list = Array.isArray(citations) ? citations : [];
  const downgraded = downgradeInvalidCitations(answer, list);
  const text = downgraded.answer;
  const { valid } = partitionCitationMarkers(text, list.length);
  if (!valid.length) {
    return {
      answer: text,
      citations: keepUncited ? list : [],
      validMarkers: [],
      invalidMarkers: downgraded.invalidMarkers,
      citationIntegrity: {
        ...downgraded.citationIntegrity,
        validMarkers: [],
        usedCount: keepUncited ? list.length : 0
      }
    };
  }
  const remap = new Map();
  const compact = [];
  for (const number of valid) {
    if (remap.has(number)) continue;
    const citation = list[number - 1];
    if (!citation) continue;
    remap.set(number, compact.length + 1);
    compact.push({ ...citation, index: compact.length + 1 });
  }
  let next = text;
  for (const number of [...remap.keys()].sort((left, right) => right - left)) {
    next = next.split(`[${number}]`).join(`[cite:${remap.get(number)}]`);
  }
  next = next.replace(/\[cite:(\d+)\]/g, '[$1]');
  return {
    answer: next,
    citations: compact,
    validMarkers: compact.map((_, index) => index + 1),
    invalidMarkers: downgraded.invalidMarkers,
    citationIntegrity: {
      status: downgraded.invalidMarkers.length ? 'downgraded' : 'ok',
      validMarkers: compact.map((_, index) => index + 1),
      invalidMarkers: downgraded.invalidMarkers,
      usedCount: compact.length
    }
  };
}

export function downgradeInvalidCitations(answer, citations = []) {
  const evidenceCount = Array.isArray(citations) ? citations.length : Number(citations) || 0;
  const { valid, invalid } = partitionCitationMarkers(answer, evidenceCount);
  if (!invalid.length) {
    return {
      answer: String(answer || ''),
      citations: Array.isArray(citations) ? citations : [],
      invalidMarkers: [],
      validMarkers: valid,
      citationIntegrity: { status: 'ok', invalidMarkers: [], validMarkers: valid }
    };
  }
  return {
    answer: stripInvalidCitationMarkers(answer, evidenceCount),
    citations: Array.isArray(citations) ? citations : [],
    invalidMarkers: invalid,
    validMarkers: valid,
    citationIntegrity: {
      status: 'downgraded',
      invalidMarkers: invalid,
      validMarkers: valid,
      reason: 'invalid_citation_markers'
    }
  };
}