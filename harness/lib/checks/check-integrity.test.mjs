import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { evaluateCheckIntegrity } from './check-integrity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skipLine = 'it' + '(' + "'x', () => { " + '.' + 'skip(' + '); });';
const ignoreLine = '//' + ' @' + 'ts-ignore';

test('A-09 deleted tests, skips, suppressions, and unprotected sensor edits fail', () => {
  const deleted = evaluateCheckIntegrity({
    nameStatus: ['D\tservices/billing/order.test.mjs'],
    diff: '',
  });
  assert.equal(deleted.exitCode, 1);
  assert.match(deleted.findings.map((f) => f.message).join('\n'), /deleted/);

  const skipped = evaluateCheckIntegrity({
    nameStatus: ['M\tservices/billing/order.test.mjs'],
    diff: ['+++ b/services/billing/order.test.mjs', '@@ -1,0 +1,1 @@', `+${skipLine}`].join('\n'),
  });
  assert.equal(skipped.exitCode, 1);

  const ignored = evaluateCheckIntegrity({
    nameStatus: ['M\tservices/billing/order.ts'],
    diff: ['+++ b/services/billing/order.ts', '@@ -1,0 +1,1 @@', `+${ignoreLine}`].join('\n'),
  });
  assert.equal(ignored.exitCode, 1);

  const sensor = evaluateCheckIntegrity({
    nameStatus: ['M\tharness/sensors/checks/unit.sh'],
    diff: '',
    session: null,
  });
  assert.equal(sensor.exitCode, 1);

  const allowed = evaluateCheckIntegrity({
    nameStatus: ['M\tharness/sensors/checks/unit.sh'],
    diff: '',
    session: {
      id: 's',
      explicitCheckEdit: {
        paths: ['all'],
        reason: 'developer instruction',
        at: new Date().toISOString(),
        by: 'developer',
        sessionId: 's',
      },
    },
  });
  assert.equal(allowed.exitCode, 0);

  const clean = evaluateCheckIntegrity({
    nameStatus: ['M\tservices/billing/order.mjs'],
    diff: ['+++ b/services/billing/order.mjs', '@@ -1,0 +1,1 @@', '+export const ok = 1;'].join(
      '\n',
    ),
  });
  assert.equal(clean.exitCode, 0);
});

test('A-10 check-integrity is a blocking turn sensor for local and ci', () => {
  const doc = parseYaml(
    fs.readFileSync(path.join(ROOT, 'harness', 'sensors', 'sensors.yaml'), 'utf8'),
  );
  const sensor = doc.sensors.find((s) => s.name === 'check-integrity');
  assert.ok(sensor);
  assert.equal(sensor.tier, 'turn');
  assert.equal(sensor.blocking, true);
  assert.deepEqual(sensor.where, ['local', 'ci']);
  assert.equal(
    fs.existsSync(path.join(ROOT, 'harness', 'sensors', 'checks', 'check-integrity.sh')),
    true,
  );
});
