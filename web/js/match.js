// Matching OCR output against the known item names.
//
// The vocabulary is closed -- 256 names -- which is what makes reading a pixel-font
// banner viable at all. OCR only has to come close, because a garbled read still
// resolves to exactly one candidate. Anything that does not clear the confidence
// bar reports nothing rather than guessing.

/** Case-folded, punctuation-stripped. Digits are preserved. */
export function normalisePlain(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** As above, plus folding the glyphs OCR routinely confuses.
 *  Only for reading text off the screen -- never for the search box, where it would
 *  turn a query of "3" into "e" and match half the list. */
export function normalise(s) {
  return normalisePlain(s)
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
    .replace(/3/g, 'e');
}

/** Levenshtein distance, iterative and allocation-light. */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[b.length];
}

/** 0..1 similarity, length-normalised. */
export function similarity(a, b) {
  const A = normalise(a), B = normalise(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const d = editDistance(A, B);
  return Math.max(0, 1 - d / Math.max(A.length, B.length));
}

/**
 * Best item for a piece of read text.
 * @returns {{item, score}|null} null when nothing clears `threshold`.
 */
export function bestMatch(text, items, { threshold = 0.62 } = {}) {
  const q = normalise(text);
  if (q.length < 3 || !Array.isArray(items) || items.length === 0) return null;

  let best = null;
  for (const item of items) {
    const n = normalise(item.name);
    if (!n) continue;
    // A clean substring hit is worth more than raw edit distance: OCR often clips
    // the leading or trailing character of a banner.
    let score = similarity(q, n);
    if (n.includes(q) || q.includes(n)) {
      score = Math.max(score, 0.8 + 0.2 * (Math.min(q.length, n.length) / Math.max(q.length, n.length)));
    }
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= threshold ? best : null;
}

/** Ranked list for the search box: substring hits first, then fuzzy. */
export function search(query, items, { limit = 60 } = {}) {
  const q = normalisePlain(query);
  if (!Array.isArray(items)) return [];
  if (!q) return items.slice(0, limit);

  const digits = /^\d+$/.test(q) ? q : null;
  const scored = [];
  for (const item of items) {
    const n = normalisePlain(item.name);
    let score = 0;
    if (digits) {
      // A bare number is an item id lookup, not a fuzzy name search.
      if (String(item.id ?? '') === digits) score = 1000;
    }
    else if (n === q) score = 1000;
    else if (n.startsWith(q)) score = 800 - n.length;
    else if (n.includes(q)) score = 600 - n.length;
    else {
      const sim = similarity(q, n);
      if (sim > 0.62) score = 100 * sim;
    }
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map(s => s.item);
}
