import fs from 'node:fs';
import path from 'node:path';
import { runCmd, which } from '../../lib/checks/common.mjs';

/**
 * boundaries via dependency-cruiser. No bespoke assertion logic.
 */
export async function run({ root, config }) {
  const bin = which('depcruise') || which('dependency-cruise');
  if (!bin && !which('npx')) {
    return {
      status: 'skipped',
      reason:
        'dependency-cruiser not installed. Enable with: npm i -D dependency-cruiser\nThen: npx depcruise --init',
    };
  }

  const configCandidates = [
    '.dependency-cruiser.cjs',
    '.dependency-cruiser.js',
    'dependency-cruiser.config.cjs',
    'dependency-cruiser.js',
  ];
  const cfg = configCandidates.find((f) => fs.existsSync(path.join(root, f)));
  if (!cfg) {
    return {
      status: 'skipped',
      reason:
        'no dependency-cruiser config. Add .dependency-cruiser.cjs forbidding service→service imports (allow contracts package only). Example: npx depcruise --init',
    };
  }

  const cmd = bin || 'npx';
  const args = bin
    ? ['--validate', cfg, config.project?.servicesGlob || 'services']
    : ['depcruise', '--validate', cfg, config.project?.servicesGlob || 'services'];

  const res = runCmd(cmd, args, { cwd: root });
  if (res.error?.code === 'ENOENT') {
    return {
      status: 'skipped',
      reason: 'dependency-cruiser not installed. npm i -D dependency-cruiser',
    };
  }
  if (res.status === 0)
    return { status: 'pass', exitCode: 0, output: res.stdout || 'boundaries ok' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
