import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChecks } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STRYKER = path.join(ROOT, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');

test('A-47 Stryker reports a survivor and it lands in report.json', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stryker-'));
  const prev = process.env.HARNESS_MUTATION_REPORT;
  try {
    fs.writeFileSync(
      path.join(tmp, 'allow.mjs'),
      'export function allow(n) {\n  if (n > 0) return true;\n  return false;\n}\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'allow.test.mjs'),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { allow } from './allow.mjs';",
        "test('positive', () => {",
        '  assert.equal(allow(1), true);',
        '});',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(tmp, 'stryker.config.json'),
      JSON.stringify(
        {
          testRunner: 'command',
          commandRunner: { command: 'node --test allow.test.mjs' },
          mutate: ['allow.mjs'],
          reporters: ['json'],
          jsonReporter: { fileName: 'reports/mutation/mutation.json' },
          concurrency: 1,
          coverageAnalysis: 'off',
          plugins: [],
        },
        null,
        2,
      ) + '\n',
    );
    const ran = spawnSync(process.execPath, [STRYKER, 'run', 'stryker.config.json'], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const mutationPath = path.join(tmp, 'reports', 'mutation', 'mutation.json');
    const mutation = JSON.parse(fs.readFileSync(mutationPath, 'utf8'));
    const mutants = mutation.files['allow.mjs'].mutants;
    assert.ok(mutants.some((m) => String(m.status).toLowerCase() === 'survived'));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stryker-report-'));
    fs.mkdirSync(path.join(root, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'harness', 'sensors', 'checks', 'ok.sh'),
      '#!/usr/bin/env bash\nexit 0\n',
    );
    fs.writeFileSync(
      path.join(root, 'harness', 'sensors', 'sensors.yaml'),
      [
        'sensors:',
        '  - name: ok',
        '    tier: edit',
        '    where: [local, ci]',
        '    blocking: false',
        '    enabled: true',
        '    missing: skip',
        '',
      ].join('\n'),
    );
    process.env.HARNESS_MUTATION_REPORT = mutationPath;
    const report = await runChecks(
      root,
      { mutation: { local: false }, backlog: { maxItems: 10 } },
      {
        tier: 'commit',
      },
    );
    const written = JSON.parse(
      fs.readFileSync(path.join(root, 'harness', 'state', 'report.json'), 'utf8'),
    );
    const blob = JSON.stringify(written);
    assert.match(blob, /mutant-survived/);
    assert.ok((report.mutants || []).some((m) => m.category === 'mutant-survived'));
    fs.rmSync(root, { recursive: true, force: true });
  } finally {
    if (prev === undefined) delete process.env.HARNESS_MUTATION_REPORT;
    else process.env.HARNESS_MUTATION_REPORT = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
