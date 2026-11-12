import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { minimatchLike } from '../util/glob.mjs';
import { addedLines } from '../checks/check-integrity.mjs';

export const DEFAULT_HUMAN_PATHS = Object.freeze([
  '**/auth/**',
  '**/payments/**',
  '**/migrations/**',
  'infra/**',
  'terraform/**',
  '.github/workflows/**',
  'harness/**',
]);

export const DEFAULT_HUMAN_PATTERNS = Object.freeze([
  'DROP\\s+TABLE',
  'DELETE\\s+FROM\\b(?!.*\\bWHERE\\b)',
  '\\bTRUNCATE\\b',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  '(?:api[_-]?key|secret|password)\\s*[:=]\\s*[\'"][^\'"]{8,}',
]);

export function humanRequiredConfig(config) {
  const spec = config?.review?.humanRequired || {};
  const paths = Array.isArray(spec.paths) && spec.paths.length ? spec.paths : [...DEFAULT_HUMAN_PATHS];
  const patterns =
    Array.isArray(spec.patterns) && spec.patterns.length ? spec.patterns : [...DEFAULT_HUMAN_PATTERNS];
  return { paths: paths.map(String), patterns: patterns.map(String) };
}

/**
 * Tracked diff plus untracked files. A new auth file is not in `git diff` until it is added.
 */
export function collectHumanInputs(root) {
  const tracked = gitLines(root, ['diff', '--name-only', 'HEAD']);
  const untracked = gitLines(root, ['ls-files', '--others', '--exclude-standard']);
  const diff = [
    gitText(root, ['diff', '-U0', 'HEAD']),
    gitText(root, ['diff', '-U0']),
    untrackedAdded(root, untracked),
  ].join('\n');
  return { files: [...new Set([...tracked, ...untracked])], diff };
}

function gitLines(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitText(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.stdout || '';
}

function untrackedAdded(root, files) {
  const chunks = [];
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    chunks.push(`+++ b/${file}`);
    chunks.push('@@ -0,0 +1,1 @@');
    for (const line of text.split('\n')) chunks.push(`+${line}`);
  }
  return chunks.join('\n');
}

function patternHits(pattern, text) {
  switch (pattern) {
    case 'DROP\\s+TABLE':
      return /DROP\s+TABLE/i.test(text);
    case 'DELETE\\s+FROM\\b(?!.*\\bWHERE\\b)':
      return /DELETE\s+FROM\b(?!.*\bWHERE\b)/i.test(text);
    case '\\bTRUNCATE\\b':
      return /\bTRUNCATE\b/i.test(text);
    case '-----BEGIN [A-Z ]*PRIVATE KEY-----':
      return /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text);
    case '(?:api[_-]?key|secret|password)\\s*[:=]\\s*[\'"][^\'"]{8,}':
      return /(?:api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}/i.test(text);
    default:
      return false;
  }
}

export function matchHumanRequired(files, diff, config) {
  const { paths, patterns } = humanRequiredConfig(config);
  const matchedPaths = [];
  for (const file of files || []) {
    const rel = String(file || '').replace(/\\/g, '/');
    if (paths.some((p) => minimatchLike(rel, p))) matchedPaths.push(rel);
  }
  const matchedPatterns = [];
  for (const row of addedLines(diff)) {
    for (const pattern of patterns) {
      if (patternHits(pattern, row.text) && !matchedPatterns.includes(pattern)) {
        matchedPatterns.push(pattern);
      }
    }
  }
  const required = matchedPaths.length > 0 || matchedPatterns.length > 0;
  return {
    required,
    status: required ? 'required' : 'none',
    paths: matchedPaths,
    patterns: matchedPatterns,
  };
}

/**
 * A required review cannot be cleared by a later panel result.
 */
export function lockHumanReview(current, attempted) {
  const status = reviewStatus(current);
  if (status === 'required') return current?.status ? current : { status: 'required', paths: [], patterns: [] };
  if (attempted == null) return current ?? { status: 'none', paths: [], patterns: [] };
  if (typeof attempted === 'string') return { status: attempted, paths: [], patterns: [] };
  return attempted;
}

export function reviewStatus(value) {
  if (!value) return 'none';
  if (typeof value === 'string') return value;
  return value.status || 'none';
}

export function annotateReport(report, match) {
  const next = { ...report };
  const incoming = {
    status: match.required ? 'required' : 'none',
    paths: match.paths || [],
    patterns: match.patterns || [],
  };
  next.humanReview = lockHumanReview(report?.humanReview, incoming);
  return next;
}

export function formatPendingHumanReview(report) {
  const review = report?.humanReview;
  if (reviewStatus(review) !== 'required') return 'human review: none';
  const paths = review.paths?.length ? review.paths.join(', ') : '(pattern only)';
  const patterns = review.patterns?.length ? `; patterns: ${review.patterns.join(', ')}` : '';
  return `human review: required (${paths}${patterns})`;
}
