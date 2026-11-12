import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyHumanGate, isTerminalUnitStatus } from '../plan/loop.mjs';
import { annotateReport, lockHumanReview, matchHumanRequired } from './human-required.mjs';

function gitRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-human-'));
  spawnSync('git', ['init'], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'README'), 'x\n');
  spawnSync('git', ['add', 'README'], { cwd: tmp });
  spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: tmp },
  );
  return tmp;
}

test('A-11 an auth file marks the unit needs-human and the next unit stays open', () => {
  const tmp = gitRepo();
  const rel = path.join('services', 'billing', 'auth', 'login.js');
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), 'export const ok = 1;\n');
  spawnSync('git', ['add', rel], { cwd: tmp });
  const session = { id: 's', unitStatus: {} };
  const gate = applyHumanGate(tmp, {}, session, 'U1');
  assert.equal(gate.moveOn, true);
  assert.equal(session.unitStatus.U1, 'needs-human');
  assert.equal(isTerminalUnitStatus(session.unitStatus.U2), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('an untracked auth file still needs a person', () => {
  const tmp = gitRepo();
  const rel = path.join('services', 'billing', 'auth', 'login.js');
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), 'export const ok = 1;\n');
  const session = { id: 's', unitStatus: {} };
  const gate = applyHumanGate(tmp, {}, session, 'U1');
  assert.equal(gate.moveOn, true);
  assert.equal(session.unitStatus.U1, 'needs-human');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-12 a DROP TABLE diff requires human review on a passing report', () => {
  const diff = ['+++ b/db/migrate.sql', '@@ -1,0 +1,1 @@', '+DROP TABLE users;'].join('\n');
  const match = matchHumanRequired(['db/migrate.sql'], diff, {});
  assert.equal(match.required, true);
  const report = annotateReport({ status: 'pass', tier: 'turn' }, match);
  assert.equal(report.status, 'pass');
  assert.equal(report.humanReview.status, 'required');
});

test('A-13 a required human review stays required', () => {
  const locked = lockHumanReview(
    { status: 'required', paths: ['services/billing/auth/login.js'], patterns: [] },
    'none',
  );
  assert.equal(locked.status, 'required');
});
