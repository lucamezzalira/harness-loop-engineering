import { runCmd, which } from '../../lib/checks/common.mjs';

export async function run({ root }) {
  if (!which('semgrep')) {
    return {
      status: 'skipped',
      reason: 'semgrep not installed. Enable with: pipx install semgrep  (or brew install semgrep)',
    };
  }
  const res = runCmd('semgrep', ['--config', 'auto', '--quiet', '--error'], {
    cwd: root,
    timeout: 300_000,
  });
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: 'sast clean' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
