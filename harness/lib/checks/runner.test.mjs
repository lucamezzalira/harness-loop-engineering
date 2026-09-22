import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSensors, countExecutableLines } from './common.mjs';
import { runChecks, reportExitCode } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('sensors.yaml validates required fields', () => {
  const sensors = loadSensors(ROOT);
  assert.ok(sensors.length >= 18);
  for (const s of sensors) {
    assert.equal(typeof s.name, 'string');
    assert.ok(['skip', 'warn', 'exit2', 'n/a'].includes(s.missing));
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
    // fake git for tree hash
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
