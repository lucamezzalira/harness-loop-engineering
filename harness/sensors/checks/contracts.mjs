import fs from 'node:fs';
import path from 'node:path';
import { runCmd, which } from '../../lib/checks/common.mjs';

/**
 * contracts: depcruise rule that publishing goes through contracts package publisher only.
 * Skip if no contracts package configured / present.
 */
export async function run({ root, config }) {
  const contracts = config.project?.contractsPackage;
  if (!contracts) {
    return {
      status: 'skipped',
      reason:
        'no contractsPackage in harness.yaml. Adding one lets services share typed events without deep imports.',
    };
  }

  // Look for a workspace package matching the name
  const pkgRoot = path.join(root, 'packages');
  let found = false;
  if (fs.existsSync(pkgRoot)) {
    for (const d of fs.readdirSync(pkgRoot)) {
      const p = path.join(pkgRoot, d, 'package.json');
      if (!fs.existsSync(p)) continue;
      const name = JSON.parse(fs.readFileSync(p, 'utf8')).name;
      if (name === contracts) found = true;
    }
  }
  if (!found) {
    return {
      status: 'skipped',
      reason: `contracts package ${contracts} not found on disk. Skip until the package exists.`,
    };
  }

  const bin = which('depcruise');
  if (!bin && !which('npx')) {
    return { status: 'skipped', reason: 'dependency-cruiser not installed' };
  }

  const cfg = ['.dependency-cruiser.cjs', '.dependency-cruiser.js'].find((f) =>
    fs.existsSync(path.join(root, f)),
  );
  if (!cfg) {
    return {
      status: 'skipped',
      reason: 'no dependency-cruiser config (contracts rules live there)',
    };
  }

  const cmd = bin || 'npx';
  const args = bin
    ? ['--validate', cfg, 'services', 'packages']
    : ['depcruise', '--validate', cfg, 'services', 'packages'];
  const res = runCmd(cmd, args, { cwd: root });
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: 'contracts boundaries ok' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
