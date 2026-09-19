import { changedFiles, runCmd, which } from '../../lib/checks/common.mjs';

export async function run({ root, files }) {
  if (!which('eslint') && !which('npx')) {
    return { status: 'skipped', reason: 'eslint not installed. Enable with: npm i -D eslint' };
  }
  const targets = (files?.length ? files : changedFiles(root)).filter((f) =>
    /\.(js|mjs|cjs|ts|tsx)$/.test(f),
  );
  if (!targets.length) return { status: 'pass', output: 'no matching changed files' };

  const useLocal = which('eslint');
  const cmd = useLocal ? 'eslint' : 'npx';
  const args = useLocal ? [...targets] : ['eslint', ...targets];
  const res = runCmd(cmd, args, { cwd: root });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'eslint not installed. Enable with: npm i -D eslint' };
  }
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: res.stdout };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
