import { runCmd, which } from '../../lib/checks/common.mjs';

/**
 * duplication with jscpd — ratchet against baseline.duplicatedBlocks
 */
export async function run({ root, config }) {
  if (!which('jscpd') && !which('npx')) {
    return { status: 'skipped', reason: 'jscpd not installed. Enable with: npm i -D jscpd' };
  }
  const cmd = which('jscpd') ? 'jscpd' : 'npx';
  const args = which('jscpd')
    ? ['.', '--silent', '--reporters', 'json']
    : ['jscpd', '.', '--silent', '--reporters', 'json'];
  const res = runCmd(cmd, args, { cwd: root, timeout: 120_000 });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'jscpd not installed' };
  }

  let clones = 0;
  try {
    const json = JSON.parse(res.stdout || '{}');
    clones = json.statistics?.total?.clones ?? json.duplicates?.length ?? 0;
  } catch {
    /* ignore */
  }

  const baseline = config.baseline?.duplicatedBlocks;
  if (baseline != null && clones > baseline) {
    return {
      status: 'fail',
      exitCode: 1,
      output: `duplicated blocks ${clones} > baseline ${baseline} (ratchet; growth only)`,
    };
  }
  if (res.status !== 0 && baseline == null) {
    return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
  }
  return { status: 'pass', exitCode: 0, output: `duplication clones=${clones}` };
}
