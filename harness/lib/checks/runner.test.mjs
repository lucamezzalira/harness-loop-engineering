import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSensors,
  countExecutableLines,
  resolveHarnessEnv,
  normalizeWhere,
} from './common.mjs';
import { runChecks, reportExitCode, printWhereSummary } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('sensors.yaml validates required fields including where', () => {
  const sensors = loadSensors(ROOT);
  assert.ok(sensors.length >= 18);
  for (const s of sensors) {
    assert.equal(typeof s.name, 'string');
    assert.ok(['skip', 'warn', 'exit2', 'n/a'].includes(s.missing));
    assert.ok(Array.isArray(s.where) && s.where.length >= 1);
    assert.equal(sensors.filter((x) => x.name === s.name).length, 1);
  }
  const whereLines = fs
    .readFileSync(path.join(ROOT, 'harness', 'sensors', 'sensors.yaml'), 'utf8')
    .split('\n')
    .filter((l) => /^\s*where:/.test(l));
  assert.equal(whereLines.length, sensors.length);
});

test('where: [] is rejected', () => {
  assert.throws(() => normalizeWhere([], 'x'), /runs nowhere/);
});

test('resolveHarnessEnv defaults to local and accepts ci', () => {
  assert.equal(resolveHarnessEnv({}), 'local');
  assert.equal(resolveHarnessEnv({ HARNESS_ENV: '' }), 'local');
  assert.equal(resolveHarnessEnv({ HARNESS_ENV: 'ci' }), 'ci');
  assert.throws(() => resolveHarnessEnv({ HARNESS_ENV: 'staging' }), /HARNESS_ENV/);
});

test('absence of where defaults to local+ci when requireWhere is false', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-where-def-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
      `sensors:
  - name: unit
    tier: turn
    blocking: true
    enabled: true
    missing: skip
`,
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'unit.sh'),
      '#!/usr/bin/env bash\necho ok\n',
    );
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'unit.sh'), 0o755);
    const sensors = loadSensors(tmp, { requireWhere: false });
    assert.deepEqual(sensors[0].where, ['local', 'ci']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('checks-are-thin: each .sh has ≤15 executable lines', () => {
  const dir = path.join(ROOT, 'harness', 'sensors', 'checks');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sh'));
  assert.ok(files.length >= 18, `expected ≥18 checks, got ${files.length}`);
  for (const f of files) {
    const n = countExecutableLines(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(n <= 15, `${f} has ${n} executable lines (max 15)`);
  }
  const mjs = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  assert.equal(mjs.length, 0, `mjs checks must be deleted, found ${mjs.join(', ')}`);
});

test('missing:skip on secrets with gitleaks absent → skipped, exit 0', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-miss-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
      `sensors:
  - name: secrets
    tier: turn
    where: [local, ci]
    blocking: true
    enabled: true
    missing: skip
`,
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'secrets.sh'),
      `#!/usr/bin/env bash
echo "gitleaks not installed. Install: brew install gitleaks" >&2
exit 3
`,
    );
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'secrets.sh'), 0o755);
    fs.mkdirSync(path.join(tmp, '.git'));
    const report = await runChecks(tmp, { verify: { failFast: true }, baseline: {} }, { tier: 'turn' });
    assert.equal(report.checks[0].status, 'skipped');
    assert.equal(reportExitCode(report), 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing:exit2 on secrets with gitleaks absent → harness-error, exit 2', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-miss2-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
      `sensors:
  - name: secrets
    tier: turn
    where: [local, ci]
    blocking: true
    enabled: true
    missing: exit2
`,
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'secrets.sh'),
      `#!/usr/bin/env bash
echo "gitleaks not installed" >&2
exit 3
`,
    );
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'secrets.sh'), 0o755);
    fs.mkdirSync(path.join(tmp, '.git'));
    const report = await runChecks(tmp, { verify: { failFast: true }, baseline: {} }, { tier: 'turn' });
    assert.equal(report.checks[0].status, 'harness-error');
    assert.equal(reportExitCode(report), 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('where filter: CI-only sensor deferred locally and runs under HARNESS_ENV=ci', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-where-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
      `sensors:
  - name: unit
    tier: commit
    where: [local, ci]
    blocking: true
    enabled: true
    missing: skip
  - name: sast
    tier: commit
    where: [ci]
    blocking: true
    enabled: true
    missing: skip
`,
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'unit.sh'),
      '#!/usr/bin/env bash\necho unit-ok\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'sast.sh'),
      '#!/usr/bin/env bash\necho sast-ok\n',
    );
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'unit.sh'), 0o755);
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'sast.sh'), 0o755);

    const local = await runChecks(
      tmp,
      { verify: { failFast: true }, baseline: {} },
      { tier: 'commit', harnessEnv: 'local' },
    );
    assert.deepEqual(
      local.checks.map((c) => c.name),
      ['unit'],
    );
    assert.deepEqual(local.deferredToCi, ['sast']);
    assert.equal(local.checks.find((c) => c.name === 'sast'), undefined);

    const ci = await runChecks(
      tmp,
      { verify: { failFast: true }, baseline: {} },
      { tier: 'commit', harnessEnv: 'ci' },
    );
    assert.deepEqual(
      ci.checks.map((c) => c.name),
      ['unit', 'sast'],
    );
    assert.deepEqual(ci.deferredToCi, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('where filter: local-only sensor skipped in ci', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-localonly-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
      `sensors:
  - name: session-state
    tier: edit
    where: [local]
    blocking: false
    enabled: true
    missing: n/a
  - name: format
    tier: edit
    where: [local, ci]
    blocking: true
    enabled: true
    missing: skip
`,
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'session-state.sh'),
      '#!/usr/bin/env bash\necho local-only\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'format.sh'),
      '#!/usr/bin/env bash\necho format-ok\n',
    );
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'session-state.sh'), 0o755);
    fs.chmodSync(path.join(tmp, 'harness', 'sensors', 'checks', 'format.sh'), 0o755);

    const ci = await runChecks(
      tmp,
      { verify: { failFast: true }, baseline: {} },
      { tier: 'edit', harnessEnv: 'ci' },
    );
    assert.deepEqual(
      ci.checks.map((c) => c.name),
      ['format'],
    );
    assert.deepEqual(ci.skippedLocalOnly, ['session-state']);

    const lines = [];
    printWhereSummary(ci, { log: (s) => lines.push(s) });
    assert.ok(lines.some((l) => /Skipped \(local-only/.test(l)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
