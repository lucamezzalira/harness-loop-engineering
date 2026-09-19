import { changedFiles, runCmd, which } from '../../lib/checks/common.mjs';

export async function run({ root, files }) {
  if (!which('stryker') && !which('npx')) {
    return {
      status: 'skipped',
      reason: 'stryker not installed. Enable with: npm i -D @stryker-mutator/core',
    };
  }
  const changed = files?.length ? files : changedFiles(root);
  const js = changed.filter((f) => /\.(js|mjs|ts)$/.test(f));
  if (!js.length) return { status: 'pass', output: 'no changed source files for mutation' };

  const cmd = which('stryker') ? 'stryker' : 'npx';
  const args = which('stryker')
    ? ['run', '--mutate', js.join(',')]
    : ['stryker', 'run', '--mutate', js.join(',')];
  const res = runCmd(cmd, args, { cwd: root, timeout: 600_000 });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'stryker not installed' };
  }
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: res.stdout.slice(0, 2000) };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
