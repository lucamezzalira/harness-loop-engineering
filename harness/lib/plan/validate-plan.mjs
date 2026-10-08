import fs from 'node:fs';
import path from 'node:path';
import { normalizeAcceptanceId, normalizeAcceptanceIds } from './acceptance-id.mjs';

/** Implementable / reviewable roots. Invented trees like init/src fail closed. */
export const ALLOWED_TOUCH_PREFIXES = Object.freeze([
  'apps/',
  'services/',
  'infra/',
  'packages/',
  'scripts/',
  'harness/',
  'specs/',
  'examples/',
  'init/wireframes/',
  'init/prds/',
]);

/**
 * Normalize unit acceptance ids in-place on a plan object.
 * @param {object} plan
 * @returns {object}
 */
export function normalizePlanAcceptance(plan) {
  for (const u of plan?.units || []) {
    u.acceptance = normalizeAcceptanceIds(u.acceptance || []);
  }
  return plan;
}

/**
 * Load acceptance ids from specs/<slug>/acceptance.json files.
 * @param {string} root
 * @param {string} [preferSlug]
 * @returns {Set<string>}
 */
export function loadAcceptanceIdSet(root, preferSlug) {
  const ids = new Set();
  const specs = path.join(root, 'specs');
  if (!fs.existsSync(specs)) return ids;
  const slugs = preferSlug
    ? [preferSlug, ...fs.readdirSync(specs).filter((s) => s !== preferSlug)]
    : fs.readdirSync(specs);
  for (const slug of slugs) {
    const accPath = path.join(specs, slug, 'acceptance.json');
    if (!fs.existsSync(accPath)) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(accPath, 'utf8'));
    } catch {
      continue;
    }
    const list = Array.isArray(raw) ? raw : raw.entries || [];
    for (const e of list) {
      const id = normalizeAcceptanceId(e?.id);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * @param {string} touch
 * @returns {boolean}
 */
export function touchPrefixAllowed(touch) {
  const t = String(touch || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!t || t.includes('..')) return false;
  return ALLOWED_TOUCH_PREFIXES.some((p) => t === p.slice(0, -1) || t.startsWith(p));
}

/**
 * Validate plan before --loop. Returns { ok, errors[] }.
 * @param {string} root
 * @param {object} plan
 * @param {{ prdSlug?: string, requireAcceptanceFile?: boolean }} [opts]
 */
export function validatePlan(root, plan, opts = {}) {
  const errors = [];
  const units = plan?.units || [];
  if (!units.length) errors.push('plan has no units');

  const accIds = loadAcceptanceIdSet(root, opts.prdSlug);
  const requireAcc = opts.requireAcceptanceFile !== false && accIds.size > 0;

  for (const u of units) {
    const id = u?.id || '(missing-id)';
    const touches = u?.touches || [];
    if (!touches.length) {
      errors.push(`${id}: touches is empty`);
    }
    for (const t of touches) {
      if (!touchPrefixAllowed(t)) {
        errors.push(
          `${id}: touch "${t}" is outside allowed roots (${ALLOWED_TOUCH_PREFIXES.join(', ')})`,
        );
      }
    }
    const acceptance = normalizeAcceptanceIds(u?.acceptance || []);
    if (requireAcc) {
      for (const a of acceptance) {
        if (!accIds.has(a)) {
          errors.push(`${id}: acceptance "${a}" not found in specs/*/acceptance.json`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
