import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { minimatchLike } from '../util/glob.mjs';
import { readSession } from '../accounting.mjs';
import { loadConfig } from '../config.mjs';

const CODE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/;
const TEST_EXT = /\.test\.(?:mjs|cjs|js|jsx|ts|tsx)$/;
const SKIP_TOKEN = '.' + 'skip(';
const ONLY_TOKEN = '.' + 'only(';
const ESLINT_TOKEN = 'eslint-' + 'disable';
const TS_IGNORE_TOKEN = '@' + 'ts-ignore';
const TS_NOCHECK_TOKEN = '@' + 'ts-nocheck';

export const DEFAULT_CHECK_PATHS = Object.freeze([
  'harness/sensors/**',
  'harness/lib/enforce/**',
  'harness/lib/checks/**',
  'verify.sh',
  'harness.yaml',
  'harness/sensors/sensors.yaml',
  'eslint.config.*',
  '.eslintrc',
  '.eslintrc.*',
  'tsconfig.json',
  'tsconfig.*.json',
  '.prettierrc',
  '.prettierrc.*',
  'prettier.config.*',
  'stryker.conf.*',
  'stryker.config.*',
]);

export function checkPathsFromConfig(config) {
  const listed = config?.protect?.checkPaths;
  if (Array.isArray(listed) && listed.length) return listed.map(String);
  return [...DEFAULT_CHECK_PATHS];
}

export function pathIsProtected(rel, patterns = DEFAULT_CHECK_PATHS) {
  const file = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((pattern) => minimatchLike(file, pattern) || file === pattern);
}

export function sessionAllowsCheckEdit(session) {
  return Boolean(session?.explicitCheckEdit);
}

/**
 * @returns {{ exitCode: number, findings: Array<{ file: string, message: string }> }}
 */
export function evaluateCheckIntegrity({
  nameStatus = [],
  diff = '',
  untracked = [],
  session = null,
  checkPaths = DEFAULT_CHECK_PATHS,
} = {}) {
  const findings = [];
  const changed = new Set();

  for (const raw of nameStatus) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const tab = line.split('\t');
    const status = tab[0] || '';
    if (status.startsWith('D') && TEST_EXT.test(tab[1] || '')) {
      findings.push({ file: tab[1], message: 'test file deleted' });
    }
    if (status.startsWith('R')) {
      const from = tab[1] || '';
      const to = tab[2] || '';
      if (TEST_EXT.test(from) || TEST_EXT.test(to)) {
        findings.push({ file: to || from, message: 'test file renamed' });
      }
      if (from) changed.add(from);
      if (to) changed.add(to);
    } else if (tab[1]) {
      changed.add(tab[1]);
    }
  }

  for (const { file, line, text } of addedLines(diff)) {
    changed.add(file);
    if (!CODE_EXT.test(file)) continue;
    if (text.includes(SKIP_TOKEN) || text.includes(ONLY_TOKEN)) {
      findings.push({ file, line, message: 'added a skipped or exclusive test' });
    }
    if (
      text.includes(ESLINT_TOKEN) ||
      text.includes(TS_IGNORE_TOKEN) ||
      text.includes(TS_NOCHECK_TOKEN)
    ) {
      findings.push({ file, line, message: 'added a suppression comment' });
    }
  }

  for (const file of untracked) {
    changed.add(file);
  }

  if (!sessionAllowsCheckEdit(session)) {
    for (const file of changed) {
      if (pathIsProtected(file, checkPaths)) {
        findings.push({
          file,
          message: 'protected check path changed without an explicit instruction record',
        });
      }
    }
  }

  return { exitCode: findings.length ? 1 : 0, findings };
}

export function addedLines(diff) {
  const out = [];
  let file = '';
  let lineNo = 0;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (!file || file === '/dev/null') continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push({ file, line: lineNo, text: line.slice(1) });
      lineNo += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) continue;
    if (!line.startsWith('\\')) lineNo += 1;
  }
  return out;
}

export function collectIntegrityInputs(root) {
  const nameStatus = gitLines(root, ['diff', '--name-status', 'HEAD']);
  const diff = gitText(root, ['diff', '-U0', 'HEAD']);
  const untracked = gitLines(root, ['ls-files', '--others', '--exclude-standard']);
  let session = null;
  try {
    session = readSession(root);
  } catch {
    session = null;
  }
  let checkPaths = [...DEFAULT_CHECK_PATHS];
  try {
    checkPaths = checkPathsFromConfig(loadConfig(root));
  } catch {
    /* defaults */
  }
  return { nameStatus, diff, untracked, session, checkPaths };
}

function gitLines(root, args) {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return (res.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function gitText(root, args) {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return res.stdout || '';
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  const result = evaluateCheckIntegrity(collectIntegrityInputs(root));
  if (result.exitCode !== 0) {
    for (const f of result.findings) {
      console.error(`${f.file}: ${f.message}`);
    }
  } else {
    console.log('check-integrity ok');
  }
  process.exit(result.exitCode);
}
