/**
 * Normalize planner/PRD acceptance refs to bare ids ("A-01").
 * Accepts "A-01", "a-01", "A-01: description…".
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeAcceptanceId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\b(A-\d+)\b/i);
  if (m) return m[1].toUpperCase();
  return s;
}

/**
 * @param {string[]} ids
 * @returns {string[]}
 */
export function normalizeAcceptanceIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const id = normalizeAcceptanceId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
