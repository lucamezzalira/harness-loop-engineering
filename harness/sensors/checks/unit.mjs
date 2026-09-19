import fs from 'node:fs';
import path from 'node:path';
import { runCmd, which } from '../../lib/checks/common.mjs';

function detectRunner(root) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vitest) return { kind: 'vitest', script: pkg.scripts?.test };
  if (deps.jest) return { kind: 'jest', script: pkg.scripts?.test };
  if (pkg.scripts?.test) return { kind: 'script', script: pkg.scripts.test };
  return { kind: 'node:test', script: 'node --test' };
}

export async function run({ root, config }) {
  const runner = detectRunner(root);
  if (!runner) {
    return { status: 'skipped', reason: 'no package.json / test runner detected' };
  }

  const pm = config.project?.packageManager || 'npm';
  let cmd;
  let args;
  if (runner.kind === 'script' || pkgHasTestScript(root)) {
    const map = {
      npm: ['npm', ['test', '--silent']],
      pnpm: ['pnpm', ['test']],
      yarn: ['yarn', ['test']],
      bun: ['bun', ['test']],
    };
    [cmd, args] = map[pm] || map.npm;
  } else if (runner.kind === 'vitest') {
    cmd = which('vitest') ? 'vitest' : 'npx';
    args = which('vitest') ? ['run'] : ['vitest', 'run'];
  } else if (runner.kind === 'jest') {
    cmd = which('jest') ? 'jest' : 'npx';
    args = which('jest') ? [] : ['jest'];
  } else {
    cmd = 'node';
    args = ['--test'];
  }

  // Prefer c8 when available for coverage on changed scope (advisory detail in output)
  const useC8 = which('c8');
  if (useC8 && cmd === 'node') {
    args = ['node', '--test'];
    cmd = 'c8';
  }

  const res = runCmd(cmd, args, { cwd: root, timeout: 180_000 });
  if (res.error?.code === 'ENOENT') {
    return {
      status: 'skipped',
      reason: `test runner unavailable (${cmd}). Add a test script or install the runner.`,
    };
  }
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: res.stdout.slice(0, 4000) };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}

function pkgHasTestScript(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts?.test);
  } catch {
    return false;
  }
}
