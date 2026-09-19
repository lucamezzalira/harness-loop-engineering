/**
 * Closed severity map schema. Roles return category only; config maps to severity.
 * Unknown categories fall to `default`.
 */

export const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

export const DEFAULT_SEVERITY_MAP = Object.freeze({
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
  default: 'P2',
});

/**
 * @param {Record<string, string>} map
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, error: string }}
 */
export function validateSeverityMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
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
