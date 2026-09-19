import fs from 'node:fs';
import path from 'node:path';
import { changedFiles, runCmd, which } from '../../lib/checks/common.mjs';

/**
 * Complexity ratchet via eslint complexity rule on changed files.
 * Fails on growth above baseline.maxComplexity when set.
 */
export async function run({ root, config, files }) {
  if (!which('eslint') && !which('npx')) {
    return {
      status: 'skipped',
      reason: 'eslint not installed (needed for complexity). npm i -D eslint',
    };
  }

  const targets = (files?.length ? files : changedFiles(root)).filter((f) =>
    /\.(js|mjs|cjs|ts|tsx)$/.test(f),
  );
  if (!targets.length) return { status: 'pass', output: 'no matching files' };

  const baseline = config.baseline?.maxComplexity;
  const defaultMax = 15;
  const maxAllowed = baseline != null ? Math.max(defaultMax, baseline) : defaultMax;

  const eslintArgs = [
    ...targets,
    '--rule',
    `complexity: ["error", ${maxAllowed}]`,
    '--format',
    'json',
  ];
  const cmd = which('eslint') ? 'eslint' : 'npx';
  const args = which('eslint') ? eslintArgs : ['eslint', ...eslintArgs];
  const res = runCmd(cmd, args, { cwd: root });

  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'eslint not installed' };
  }

  let findings = [];
  try {
    const parsed = JSON.parse(res.stdout || '[]');
    for (const file of parsed) {
      for (const msg of file.messages || []) {
        if (msg.ruleId === 'complexity') {
          findings.push(`${path.relative(root, file.filePath)}:${msg.line} ${msg.message}`);
        }
      }
    }
  } catch {
    if (res.status !== 0) {
      return { status: 'fail', exitCode: 1, output: res.stdout + res.stderr };
    }
  }

  // Ratchet messaging when baseline is in play
  if (findings.length && baseline != null && baseline > defaultMax) {
    return {
      status: 'fail',
      exitCode: 1,
      output:
        `Complexity exceeded baseline.maxComplexity=${baseline} (ratchet; growth only).\n` +
        findings.join('\n'),
    };
  }

  if (findings.length) {
    return { status: 'fail', exitCode: 1, output: findings.join('\n') };
  }
  return { status: 'pass', exitCode: 0, output: `complexity ≤ ${maxAllowed}` };
}
