import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

/**
 * Load sensors.yaml — single source of order, tier, blocking, enablement.
 * Filenames carry no meaning.
 * @param {string} root
 */
export function loadSensors(root) {
  const p = path.join(root, 'harness', 'sensors', 'sensors.yaml');
  if (!fs.existsSync(p)) {
    const err = new Error(`Missing ${p}`);
    err.exitCode = 2;
    throw err;
  }
  const doc = parseYaml(fs.readFileSync(p, 'utf8'));
  return doc.sensors || [];
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
