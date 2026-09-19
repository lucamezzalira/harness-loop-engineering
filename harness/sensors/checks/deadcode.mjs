import { runCmd, which } from '../../lib/checks/common.mjs';

export async function run({ root }) {
  if (!which('knip') && !which('npx')) {
    return { status: 'skipped', reason: 'knip not installed. Enable with: npm i -D knip' };
  }
  const cmd = which('knip') ? 'knip' : 'npx';
  const args = which('knip') ? [] : ['knip'];
  const res = runCmd(cmd, args, { cwd: root });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'knip not installed' };
  }
  if (res.status === 0)
    return { status: 'pass', exitCode: 0, output: res.stdout || 'no dead code' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
