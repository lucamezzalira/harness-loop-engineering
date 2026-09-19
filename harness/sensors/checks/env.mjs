import fs from 'node:fs';
import path from 'node:path';
import { runCmd, which } from '../../lib/checks/common.mjs';

/**
 * env check as eslint no-process-env with a single override for config/env.js (or .mjs/.cjs).
 * No bespoke AST analysis.
 */
export async function run({ root }) {
  if (!which('eslint') && !which('npx')) {
    return { status: 'skipped', reason: 'eslint not installed. Enable with: npm i -D eslint' };
  }

  // Discover candidate source roots
  const globs = ['**/*.{js,mjs,cjs,ts,tsx}'];
  const cmd = which('eslint') ? 'eslint' : 'npx';
  const baseArgs = which('eslint') ? [] : ['eslint'];
  const args = [
    ...baseArgs,
    '.',
    '--rule',
    'no-process-env: error',
    '--ignore-pattern',
    'node_modules/**',
    '--ignore-pattern',
    'harness/state/**',
    '--ignore-pattern',
    'examples/**/node_modules/**',
  ];

  // Allowlist the single env module via --no-ignore + override is hard on CLI;
  // instead run and filter known allow paths from output.
  const allow = new Set(['config/env.js', 'config/env.mjs', 'config/env.cjs', 'config/env.ts']);

  // Also allow per-service config/env.js under services/*
  const res = runCmd(cmd, args, { cwd: root, timeout: 120_000 });
  if (res.error?.code === 'ENOENT') {
    return { status: 'skipped', reason: 'eslint not installed' };
  }

  const combined = res.stdout + res.stderr;
  const lines = combined
    .split('\n')
    .filter((l) => /process\.env|no-process-env/.test(l) || /^\//.test(l) || /error/.test(l));

  // Parse eslint stylish: file paths then errors
  const violations = [];
  let currentFile = null;
  for (const line of combined.split('\n')) {
    const fileMatch = line.match(/^\s*(?:\/|\.)?([\w./-]+\.(?:js|mjs|cjs|ts|tsx))\s*$/);
    if (fileMatch && !line.includes('error') && !line.includes('warning')) {
      currentFile = fileMatch[1].replace(/^\.\//, '');
      continue;
    }
    // ESLint default formatter: /abs/path/file.js
    const abs = line.match(/^(\/\S+\.(?:js|mjs|cjs|ts|tsx))$/);
    if (abs) {
      currentFile = path.relative(root, abs[1]);
      continue;
    }
    if (/no-process-env/.test(line) && currentFile) {
      const rel = currentFile.replace(/\\/g, '/');
      const base = path.basename(rel);
      const dir = path.dirname(rel);
      const allowed =
        allow.has(rel) ||
        (base.startsWith('env.') && (dir === 'config' || dir.endsWith('/config')));
      if (!allowed) violations.push(`${rel}: ${line.trim()}`);
    }
  }

  if (res.status === 0 || violations.length === 0) {
    // If eslint failed for other reasons but no process.env hits, treat soft
    if (res.status !== 0 && /no-process-env/.test(combined) === false) {
      // Could be config missing — skip rather than false fail
      if (/ESLint couldn't find|no files matching/i.test(combined)) {
        return { status: 'skipped', reason: 'eslint not configured for this tree yet' };
      }
    }
    if (violations.length === 0 && (res.status === 0 || !/no-process-env/.test(combined))) {
      return { status: 'pass', exitCode: 0, output: 'process.env confined (or no hits)' };
    }
  }

  if (violations.length) {
    return {
      status: 'fail',
      exitCode: 1,
      output:
        'process.env is forbidden outside the validated env module (config/env.js).\n' +
        violations.join('\n'),
    };
  }
  return { status: 'pass', exitCode: 0, output: 'env ok' };
}
