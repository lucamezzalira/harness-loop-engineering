import { spawnSync } from 'node:child_process';

const DEFAULT_THRESHOLD = 800;

export async function run({ root, config }) {
  const threshold = config.verify?.prSizeLines ?? DEFAULT_THRESHOLD;
  const res = spawnSync('git', ['diff', '--stat', 'HEAD'], { cwd: root, encoding: 'utf8' });
  // Count added+deleted from numstat
  const num = spawnSync('git', ['diff', '--numstat', 'HEAD'], { cwd: root, encoding: 'utf8' });
  let lines = 0;
  for (const row of (num.stdout || '').split('\n')) {
    const [a, d] = row.split('\t');
    if (!a) continue;
    lines += (parseInt(a, 10) || 0) + (parseInt(d, 10) || 0);
  }
  if (lines > threshold) {
    return {
      status: 'fail',
      exitCode: 1,
      output: `diff is ${lines} lines; threshold ${threshold}. Split the change or raise verify.prSizeLines with a reason.`,
    };
  }
  return { status: 'pass', exitCode: 0, output: `diff ${lines} lines (≤ ${threshold})` };
}
