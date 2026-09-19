import { runCmd, which } from '../../lib/checks/common.mjs';

/**
 * secrets: missing gitleaks → exit 2 (harness broken, not a soft skip).
 */
export async function run({ root }) {
  if (!which('gitleaks')) {
    return {
      status: 'harness-error',
      exitCode: 2,
      reason:
        'gitleaks not installed. A harness with no secret scanning is broken rather than passing. Install: https://github.com/gitleaks/gitleaks#installing',
      output:
        'gitleaks not installed. A harness with no secret scanning is broken rather than passing. Install: https://github.com/gitleaks/gitleaks#installing',
    };
  }
  const res = runCmd('gitleaks', ['protect', '--staged', '--no-banner', '-v'], { cwd: root });
  if (res.status === 0) return { status: 'pass', exitCode: 0, output: 'no secrets detected' };
  return { status: 'fail', exitCode: res.status ?? 1, output: res.stdout + res.stderr };
}
