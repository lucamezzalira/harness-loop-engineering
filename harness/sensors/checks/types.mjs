import { runCmd, which } from '../../lib/checks/common.mjs';

export async function run({ root }) {
  if (!which('tsc') && !which('npx')) {
    return { status: 'skipped', reason: 'tsc not installed. Enable with: npm i -D typescript' };
  }
  const cmd = which('tsc') ? 'tsc' : 'npx';
  const args = which('tsc')
    ? ['--allowJs', '--checkJs', '--noEmit', '--pretty', 'false']
    : ['tsc', '--allowJs', '--checkJs', '--noEmit', '--pretty', 'false'];
  const res = runCmd(cmd, args, { cwd: root });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'tsc not installed' };
  }
  // advisory: map fail to warn at runner for non-blocking
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: 'types ok' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
