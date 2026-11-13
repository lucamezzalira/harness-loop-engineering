import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { evaluateCheckIntegrity } from './check-integrity.mjs';
import { checkEditLogLine } from '../enforce/check-edit-record.mjs';

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

  const record = {
    paths: ['all'],
    reason: 'developer instruction',
    at: new Date().toISOString(),
    by: 'developer',
    sessionId: 's',
  };
  const allowed = evaluateCheckIntegrity({
    nameStatus: ['M\tharness/sensors/checks/unit.sh'],
    diff: '',
    session: { id: 's', explicitCheckEdit: record },
    logText: checkEditLogLine(record),
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

test('A-76 a local approval prints the early-warning line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-warn-'));
  const git = (args) => {
    const result = spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args],
      {
        cwd: tmp,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init']);
  fs.writeFileSync(path.join(tmp, 'harness.yaml'), 'project:\n  name: base\n');
  git(['add', 'harness.yaml']);
  git(['commit', '-m', 'base']);
  fs.writeFileSync(path.join(tmp, 'harness.yaml'), 'project:\n  name: next\n');
  const record = {
    paths: ['all'],
    reason: 'local early warning',
    at: new Date().toISOString(),
    by: 'developer',
    sessionId: 's',
  };
  fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'harness', 'state', 'session.json'),
    JSON.stringify({ id: 's', explicitCheckEdit: record }) + '\n',
  );
  fs.writeFileSync(path.join(tmp, 'harness', 'state', 'check-edits.log'), checkEditLogLine(record));
  const ran = spawnSync(
    process.execPath,
    [path.join(ROOT, 'harness', 'lib', 'checks', 'check-integrity.mjs')],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HARNESS_ROOT: tmp },
    },
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  assert.match(ran.stdout, /local approval only; CI protected-change decides on the pull request/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-77 local approval is not described as the decision', () => {
  const forbidden = [
    'proof of approval',
    'authoritative approval',
    'can still approve',
    'the record approves',
    'local record is the approval',
  ];
  const hits = [];
  for (const phrase of forbidden) {
    const listed = spawnSync(
      'grep',
      [
        '-R',
        '-i',
        '-n',
        '-F',
        '--exclude=check-integrity.test.mjs',
        '-e',
        phrase,
        'harness',
        'docs',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (listed.stdout && listed.stdout.trim()) hits.push(listed.stdout.trim());
  }
  assert.deepEqual(hits, []);
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
