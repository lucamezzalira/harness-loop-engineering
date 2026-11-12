import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { countExecutableLines } from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('A-31 audit is blocking in CI and a high advisory fixture fails', () => {
  const doc = parseYaml(
    fs.readFileSync(path.join(ROOT, 'harness', 'sensors', 'sensors.yaml'), 'utf8'),
  );
  const sensor = doc.sensors.find((s) => s.name === 'audit');
  assert.equal(sensor.blocking, true);
  assert.deepEqual(sensor.where, ['ci']);
  const script = path.join(ROOT, 'harness', 'sensors', 'checks', 'audit.sh');
  const lines = countExecutableLines(fs.readFileSync(script, 'utf8'));
  assert.ok(lines <= 15, `audit.sh has ${lines} executable lines`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-'));
  const fixture = path.join(tmp, 'advisory.json');
  fs.writeFileSync(fixture, '{"advisories":[{"severity": "high"}]}\n');
  try {
    const result = spawnSync('bash', [script], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        HARNESS_ROOT: ROOT,
        HARNESS_AUDIT_FIXTURE: fixture,
        HARNESS_CONFIG_JSON: JSON.stringify({ project: { packageManager: 'npm' } }),
      },
    });
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /high or critical/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
