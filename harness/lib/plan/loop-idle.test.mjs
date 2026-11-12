import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runLoop } from './loop.mjs';

function commit(tmp, message) {
  spawnSync('git', ['add', '-A'], { cwd: tmp });
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', message],
    { cwd: tmp },
  );
  assert.equal(result.status, 0, result.stderr?.toString() || 'commit failed');
}

function repo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-idle-'));
  spawnSync('git', ['init'], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'harness/state/\nharness/retro/\n');
  fs.mkdirSync(path.join(tmp, 'specs', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'specs', 'demo', 'PRD.md'), '# demo\n');
  fs.writeFileSync(path.join(tmp, 'README'), 'x\n');
  commit(tmp, 'init');
  return tmp;
}

function config() {
  return {
    tool: 'cursor',
    profile: 'default',
    confirmProfile: false,
    roles: { reviewer: { enabled: true } },
    review: {
      blockAt: ['P0', 'P1'],
      maxCycles: 1,
      cadence: { ship: ['reviewer'], unit: ['reviewer'], turn: ['reviewer'] },
    },
    models: {
      profiles: { default: { reviewer: 'deep' } },
      tiers: { deep: { provider: 'anthropic', id: 'fake-model' } },
      providers: { anthropic: { type: 'anthropic' } },
    },
    severity: { categories: {}, default: 'P2' },
    backlog: { maxItems: 10, promoteAfterUnits: 3 },
    loop: {
      prd: 'specs/demo/PRD.md',
      maxTurns: 2,
      maxSeconds: 60,
      maxCostUsd: 5,
      gate: 'never',
      stopOnIdenticalFailures: 2,
    },
  };
}

test('A-17 nothing-to-do exits 0 and an empty done loop exits 1', async () => {
  const missing = repo();
  fs.rmSync(path.join(missing, 'specs'), { recursive: true, force: true });
  const missingResult = await runLoop(missing, config());
  assert.equal(missingResult.exitCode, 0);
  assert.equal(missingResult.stopReason, 'nothing-to-do');
  assert.match(missingResult.message, /^nothing-to-do: missing PRD$/);
  fs.rmSync(missing, { recursive: true, force: true });

  const empty = repo();
  const emptyResult = await runLoop(empty, config());
  assert.equal(emptyResult.exitCode, 0);
  assert.match(emptyResult.message, /^nothing-to-do: empty plan$/);
  fs.rmSync(empty, { recursive: true, force: true });

  const done = repo();
  fs.mkdirSync(path.join(done, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(done, 'harness', 'state', 'plan.json'),
    JSON.stringify({
      units: [
        { id: 'U1', title: 'done', touches: ['specs/demo'], acceptance: [], estimatedTurns: 1 },
      ],
      waves: [['U1']],
    }) + '\n',
  );
  fs.writeFileSync(
    path.join(done, 'harness', 'state', 'session.json'),
    JSON.stringify({
      id: 's',
      turns: 1,
      roles: {},
      units: {},
      panelCycles: {},
      unitStatus: { U1: 'complete' },
      stopReason: 'complete',
    }) + '\n',
  );
  const doneResult = await runLoop(done, config());
  assert.equal(doneResult.exitCode, 0);
  assert.match(doneResult.message, /^nothing-to-do: no incomplete units$/);
  fs.rmSync(done, { recursive: true, force: true });

  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  const emptyDone = repo();
  try {
    fs.mkdirSync(path.join(emptyDone, 'harness', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(emptyDone, 'harness', 'state', 'plan.json'),
      JSON.stringify({
        units: [
          { id: 'U1', title: 'done', touches: ['specs/demo'], acceptance: [], estimatedTurns: 1 },
        ],
        waves: [['U1']],
      }) + '\n',
    );
    fs.writeFileSync(
      path.join(emptyDone, 'harness', 'state', 'session.json'),
      JSON.stringify({
        id: 's',
        turns: 1,
        roles: {},
        units: {},
        panelCycles: {},
        unitStatus: { U1: 'complete' },
        stopReason: 'ship-panel-blocking',
      }) + '\n',
    );
    const result = await runLoop(emptyDone, config());
    assert.equal(result.exitCode, 1);
    assert.equal(result.message, 'done-without-changes');
    assert.equal(result.session.stopReason, 'done-without-changes');
  } finally {
    if (prev == null) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
    fs.rmSync(emptyDone, { recursive: true, force: true });
  }
});
