import fs from 'node:fs';
import path from 'node:path';
import { runCmd } from '../../lib/checks/common.mjs';

export async function run({ root, config }) {
  const pm = config.project?.packageManager || detectPm(root);
  const map = {
    npm: ['npm', ['audit', '--audit-level=high']],
    pnpm: ['pnpm', ['audit', '--audit-level', 'high']],
    yarn: ['yarn', ['npm', 'audit', '--level', 'high']],
    bun: ['bun', ['pm', 'audit', '--level', 'high']],
  };
  const [cmd, args] = map[pm] || map.npm;
  const res = runCmd(cmd, args, { cwd: root });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: `${cmd} not available for audit` };
  }
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: 'audit clean (high+)' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}

function detectPm(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}
