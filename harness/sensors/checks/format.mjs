import { changedFiles, runCmd, which } from '../../lib/checks/common.mjs';

export async function run({ root, files }) {
  const bin = which('prettier') || which('npx');
  if (!which('prettier') && !which('npx')) {
    return {
      status: 'skipped',
      reason: 'prettier not installed. Enable with: npm i -D prettier',
    };
  }
  const targets = (files?.length ? files : changedFiles(root)).filter((f) =>
    /\.(js|mjs|cjs|ts|tsx|json|md|yml|yaml)$/.test(f),
  );
  if (!targets.length) {
    return { status: 'pass', output: 'no matching changed files' };
  }
  const args = which('prettier') ? ['--check', ...targets] : ['prettier', '--check', ...targets];
  const cmd = which('prettier') ? 'prettier' : 'npx';
  const res = runCmd(cmd, args, { cwd: root });
  if (res.error && res.error.code === 'ENOENT') {
    return { status: 'skipped', reason: 'prettier not installed. Enable with: npm i -D prettier' };
  }
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: res.stdout };
  return {
    status: 'fail',
    exitCode: res.status ?? 1,
    output: res.stdout + res.stderr,
  };
}
