/**
 * Closed severity map schema. Roles return category only; config maps to severity.
 * Unknown categories fall to `default`.
 *
 * Accepted shapes in harness.yaml:
 *   severity: { categories: { … }, default: P2 }   (preferred)
 *   severity: { 'secret-exposed': P0, …, default: P2 }  (flat, legacy)
 */

export const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

export const DEFAULT_SEVERITY_CATEGORIES = Object.freeze({
  'secret-exposed': 'P0',
  'pii-in-logs': 'P0',
  'boundary-violation': 'P0',
  'contract-breaking': 'P0',
  'acceptance-unmet': 'P1',
  'missing-idempotency': 'P1',
  'error-swallowed': 'P1',
  duplication: 'P2',
  naming: 'P3',
  style: 'P3',
});

/** Flat map used at runtime (category → severity, plus `default`). */
export const DEFAULT_SEVERITY_MAP = Object.freeze({
  ...DEFAULT_SEVERITY_CATEGORIES,
  default: 'P2',
});

/**
 * Collapse nested `{ categories, default }` (or flat) into a flat map.
 * @param {unknown} raw
 * @returns {Record<string, string> | null}
 */
export function normalizeSeverityInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.categories && typeof raw.categories === 'object' && !Array.isArray(raw.categories)) {
    return { ...raw.categories, default: raw.default };
  }
  const out = { ...raw };
  delete out.categories;
  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, error: string }}
 */
export function validateSeverityMap(raw) {
  const map = normalizeSeverityInput(raw);
  if (!map) {
    return { ok: false, error: 'severity must be a mapping of category → P0|P1|P2|P3' };
  }
  if (!Object.prototype.hasOwnProperty.call(map, 'default')) {
    return { ok: false, error: 'severity.default is required (fallback for unknown categories)' };
  }
  for (const [cat, sev] of Object.entries(map)) {
    if (!SEVERITIES.includes(sev)) {
      return {
        ok: false,
        error: `severity.${cat}="${sev}" is invalid; allowed: ${SEVERITIES.join(', ')}`,
      };
    }
  }
  return { ok: true, map: { ...map } };
}

/**
 * @param {string} category
 * @param {Record<string, string>} map
 */
export function mapCategory(category, map) {
  if (Object.prototype.hasOwnProperty.call(map, category)) return map[category];
  return map.default ?? 'P2';
}

export function severityRank(sev) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[sev] ?? 99;
}
