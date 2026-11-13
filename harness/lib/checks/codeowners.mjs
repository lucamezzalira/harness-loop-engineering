import fs from 'node:fs';
import path from 'node:path';
import { minimatchLike } from '../util/glob.mjs';
import { checkPathsFromConfig } from './check-integrity.mjs';
import { humanRequiredConfig } from '../review/human-required.mjs';

export function codeownersFile(root) {
  return path.join(root, '.github', 'CODEOWNERS');
}

export function loginOf(token) {
  return String(token || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

/**
 * @param {string} text
 * @returns {Array<{ pattern: string, owners: string[] }>}
 */
export function parseCodeowners(text) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const owners = parts.slice(1).map(loginOf).filter(Boolean);
    lines.push({ pattern: parts[0], owners });
  }
  return lines;
}

export function readCodeowners(root) {
  try {
    return parseCodeowners(fs.readFileSync(codeownersFile(root), 'utf8'));
  } catch {
    return [];
  }
}

export function codeownersMatch(pattern, file) {
  let spec = String(pattern || '')
    .replace(/\\/g, '/')
    .replace(/^\//, '');
  const rel = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!spec || !rel) return false;
  if (minimatchLike(rel, spec)) return true;
  if (!spec.includes('/')) return minimatchLike(rel, `**/${spec}`);
  return false;
}

export function patternCoversGlob(pattern, glob) {
  const spec = String(pattern || '')
    .replace(/\\/g, '/')
    .replace(/^\//, '');
  const target = String(glob || '')
    .replace(/\\/g, '/')
    .replace(/^\//, '');
  if (!spec || !target) return false;
  if (spec === target) return true;
  return minimatchLike(target, spec);
}

export function ownersForFile(lines, file) {
  let owners = [];
  for (const line of lines || []) {
    if (codeownersMatch(line.pattern, file)) owners = line.owners;
  }
  return owners;
}

export function ownerLogins(lines) {
  const names = new Set();
  for (const line of lines || []) {
    for (const owner of line.owners) names.add(owner);
  }
  return names;
}

export function globsToCover(config) {
  const listed = [...checkPathsFromConfig(config), ...humanRequiredConfig(config).paths];
  const out = [];
  for (const glob of listed) {
    if (!out.includes(glob)) out.push(glob);
  }
  return out;
}

export function broadOverrides(lines) {
  const hits = [];
  for (let i = 0; i < (lines || []).length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const earlier = lines[i].pattern;
      const later = lines[j].pattern;
      if (earlier === later) continue;
      if (patternCoversGlob(later, earlier) && !patternCoversGlob(earlier, later)) {
        hits.push({ later, earlier });
      }
    }
  }
  return hits;
}

export function uncoveredGlobs(config, lines) {
  const missing = [];
  for (const glob of globsToCover(config)) {
    let owners = null;
    for (const line of lines || []) {
      if (patternCoversGlob(line.pattern, glob)) owners = line.owners;
    }
    if (!owners || !owners.length) missing.push(glob);
  }
  return missing;
}
