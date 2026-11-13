import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { triageBacklog, renderBacklog, writeBacklog } from './backlog.mjs';
import { readSession, renderReport } from '../accounting.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');

const SNAPSHOT = [
  'Backlog (P2 and below) — triage: keep, discard, or promote to a spec',
  '',
  '- [P2] reviewer a.js:1  naming is off  (style)',
  '',
].join('\n');

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-backlog-'));
  const items = [1, 2, 3, 4, 5].map((n) => ({
    severity: 'P2',
    role: 'reviewer',
    file: `f${n}.js`,
    line: n,
    message: `finding ${n}`,
    category: 'style',
  }));
  writeBacklog(tmp, { items, categoryHits: {} });
  return tmp;
}

test('A-40 discarding 2 of 5 reviewer findings yields a 40% dismissed rate', async () => {
  const tmp = fixture();
  const answers = ['discard', 'discard', 'keep', 'keep', 'keep'];
  await triageBacklog(tmp, {
    isTTY: () => true,
    ask: async () => answers.shift(),
  });
  const session = readSession(tmp);
  assert.equal(session.dismissedByRole.reviewer, 2);
  const report = renderReport(tmp);
  assert.match(report, /reviewer: total 5, fixed 0, dismissed 2, dismissed rate 40%/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-42 --backlog without a TTY matches the snapshot', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-backlog-snap-'));
  writeBacklog(tmp, {
    items: [
      {
        severity: 'P2',
        role: 'reviewer',
        file: 'a.js',
        line: 1,
        message: 'naming is off',
        category: 'style',
      },
    ],
    categoryHits: {},
  });
  assert.equal(renderBacklog(tmp), SNAPSHOT);
  const spawned = spawnSync(process.execPath, [CLI, '--backlog'], {
    cwd: tmp,
    env: { ...process.env, HARNESS_ROOT: tmp },
    encoding: 'utf8',
  });
  assert.equal(spawned.status, 0, spawned.stderr);
  assert.equal(spawned.stdout, SNAPSHOT);
  fs.rmSync(tmp, { recursive: true, force: true });
});
