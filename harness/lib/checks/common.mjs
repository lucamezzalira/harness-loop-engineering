import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const REQUIRED_SENSOR_KEYS = ['name', 'tier', 'where', 'blocking', 'enabled', 'missing'];
const VALID_MISSING = new Set(['skip', 'warn', 'exit2', 'n/a']);
const VALID_TIERS = new Set(['edit', 'turn', 'commit', 'manual']);
const VALID_WHERE = new Set(['local', 'ci']);

/**
 * Resolve harness environment from HARNESS_ENV.
 * Unset → local. Explicit only; never infer from $CI.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'local' | 'ci'}
 */
export function resolveHarnessEnv(env = process.env) {
  const raw = env.HARNESS_ENV;
  if (raw == null || String(raw).trim() === '') return 'local';
  const v = String(raw).trim();
  if (v !== 'local' && v !== 'ci') {
    const err = new Error(`HARNESS_ENV must be "local" or "ci", got "${v}"`);
    err.exitCode = 2;
    throw err;
  }
  return v;
}

/**
 * Normalize and validate `where`. Empty arrays are a config error.
 * @param {unknown} where
 * @param {string} label
 * @returns {('local' | 'ci')[]}
 */
export function normalizeWhere(where, label = 'sensor') {
  if (where == null) {
    return ['local', 'ci'];
  }
  if (!Array.isArray(where)) {
    const err = new Error(`sensors.yaml entry "${label}" where must be an array`);
    err.exitCode = 2;
    throw err;
  }
  if (where.length === 0) {
    const err = new Error(
      `sensors.yaml entry "${label}" where: [] is invalid (a sensor that runs nowhere is a bug)`,
    );
    err.exitCode = 2;
    throw err;
  }
  const out = [];
  for (const w of where) {
    if (!VALID_WHERE.has(w)) {
      const err = new Error(
        `sensors.yaml entry "${label}" where entry "${w}" is invalid; allowed: local, ci`,
      );
      err.exitCode = 2;
      throw err;
    }
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * Load sensors.yaml — single source of order, tier, where, blocking, enablement, missing.
 * Filenames carry no meaning. Unknown keys or values exit 2 naming the entry.
 * @param {string} root
 * @param {{ requireWhere?: boolean }} [opts]
 */
export function loadSensors(root, opts = {}) {
  const requireWhere = opts.requireWhere !== false;
  const p = path.join(root, 'harness', 'sensors', 'sensors.yaml');
  if (!fs.existsSync(p)) {
    const err = new Error(`Missing ${p}`);
    err.exitCode = 2;
    throw err;
  }
  const doc = parseYaml(fs.readFileSync(p, 'utf8'));
  const sensors = doc.sensors || [];
  const allowed = new Set(REQUIRED_SENSOR_KEYS);
  for (const [i, s] of sensors.entries()) {
    const label = s?.name || `#${i}`;
    for (const key of REQUIRED_SENSOR_KEYS) {
      if (key === 'where' && !requireWhere && !('where' in (s || {}))) continue;
      if (!(key in (s || {}))) {
        const err = new Error(`sensors.yaml entry "${label}" missing required field "${key}"`);
        err.exitCode = 2;
        throw err;
      }
    }
    for (const key of Object.keys(s)) {
      if (!allowed.has(key)) {
        const err = new Error(`sensors.yaml entry "${label}" has unknown key "${key}"`);
        err.exitCode = 2;
        throw err;
      }
    }
    if (!VALID_MISSING.has(s.missing)) {
      const err = new Error(
        `sensors.yaml entry "${label}" missing must be skip|warn|exit2|n/a, got "${s.missing}"`,
      );
      err.exitCode = 2;
      throw err;
    }
    if (!VALID_TIERS.has(s.tier)) {
      const err = new Error(`sensors.yaml entry "${label}" invalid tier "${s.tier}"`);
      err.exitCode = 2;
      throw err;
    }
    if (typeof s.blocking !== 'boolean' || typeof s.enabled !== 'boolean') {
      const err = new Error(`sensors.yaml entry "${label}" blocking and enabled must be booleans`);
      err.exitCode = 2;
      throw err;
    }
    s.where = normalizeWhere(s.where, label);
  }
  return sensors;
}

/**
 * @param {string} root
 * @param {string} name
 */
export function loadGuidance(root, name) {
  const p = path.join(root, 'harness', 'sensors', 'guidance', `${name}.md`);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8').trim();
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: object, timeout?: number }} opts
 */
export function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    timeout: opts.timeout ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: res.status,
    signal: res.signal,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error,
  };
}

export function which(bin) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
  });
  return res.status === 0 ? res.stdout.trim().split('\n')[0] : null;
}

/**
 * Changed files for edit/turn scope.
 * @param {string} root
 * @param {string[]} [onlyFiles]
 */
export function changedFiles(root, onlyFiles) {
  if (onlyFiles?.length) return onlyFiles.map((f) => path.relative(root, path.resolve(root, f)));
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: root,
    encoding: 'utf8',
  });
  const unstaged = spawnSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  const set = new Set(
    [
      ...(staged.stdout || '').split('\n'),
      ...(unstaged.stdout || '').split('\n'),
      ...(untracked.stdout || '').split('\n'),
    ]
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return [...set];
}

export function wrapWithGuidance(root, name, toolOutput) {
  const g = loadGuidance(root, name);
  if (!g) return toolOutput;
  return `${g}\n\n--- tool output ---\n${toolOutput}`;
}

/**
 * Count executable lines in a check script (excludes shebang, blank, comment-only lines).
 * @param {string} content
 */
export function countExecutableLines(content) {
  return content
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('#!')) return false;
      if (t.startsWith('#')) return false;
      return true;
    }).length;
}
