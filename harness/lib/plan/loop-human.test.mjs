import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runLoop } from './loop.mjs';
import { readSession } from '../accounting.mjs';

function commit(tmp, message) {
  spawnSync('git', ['add', '-A'], { cwd: tmp });
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', message],
    { cwd: tmp },
  );
  assert.equal(result.status, 0, result.stderr?.toString() || 'commit failed');
}

function config() {
  return {
    tool: 'cursor',
    profile: 'default',
    confirmProfile: false,
    roles: {
      reviewer: { enabled: true },
      planner: { enabled: true },
      security: { enabled: false },
      product: { enabled: false },
      qa: { enabled: false },
      infra: { enabled: false },
      'test-writer': { enabled: false },
      'acceptance-checker': { enabled: false },
      'integrity-checker': { enabled: false },
    },
    review: {
      blockAt: ['P0', 'P1'],
      maxCycles: 1,
      cadence: { ship: ['reviewer'], unit: ['reviewer'], turn: ['reviewer'], wave: ['reviewer'] },
    },
    models: {
      profiles: { default: { reviewer: 'deep', planner: 'deep' } },
      tiers: { deep: { provider: 'anthropic', id: 'fake-model' } },
      providers: { anthropic: { type: 'anthropic' } },
    },
    severity: { default: 'P2' },
    backlog: { maxItems: 10, promoteAfterUnits: 3 },
    loop: {
      prd: 'specs/demo/PRD.md',
      maxTurns: 6,
      maxSeconds: 60,
      maxCostUsd: 5,
      gate: 'never',
      stopOnIdenticalFailures: 2,
    },
  };
}

test('A-43 the loop marks the auth unit needs-human and still finishes the next unit', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-human-loop-'));
  const prevFake = process.env.HARNESS_FAKE_PROVIDER;
  const prevWrite = process.env.HARNESS_FAKE_WRITE;
  const prevRoot = process.env.HARNESS_FAKE_ROOT;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  process.env.HARNESS_FAKE_WRITE = 'U1=services/x/auth/login.js';
  process.env.HARNESS_FAKE_ROOT = tmp;
  try {
    spawnSync('git', ['init'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'harness/state/\nharness/retro/\n');
    fs.mkdirSync(path.join(tmp, 'specs', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', 'demo', 'PRD.md'), '# demo\n');
    fs.writeFileSync(
      path.join(tmp, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({
        entries: [
          { id: 'A-01', passes: true, test: 'services/x/auth/login.test.mjs' },
          { id: 'A-02', passes: true, test: 'services/x/billing/bill.test.mjs' },
        ],
      }) + '\n',
    );
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'checks', 'ok.sh'),
      '#!/usr/bin/env bash\nexit 0\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
      [
        'sensors:',
        '  - name: ok',
        '    tier: turn',
        '    where: [local, ci]',
        '    blocking: true',
        '    enabled: true',
        '    missing: skip',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(tmp, 'harness', 'state', 'plan.json'),
      JSON.stringify({
        units: [
          {
            id: 'U1',
            title: 'auth',
            touches: ['services/x/auth/**'],
            acceptance: ['A-01'],
            estimatedTurns: 1,
          },
          {
            id: 'U2',
            title: 'billing',
            touches: ['services/x/billing/**'],
            acceptance: ['A-02'],
            estimatedTurns: 1,
          },
        ],
        waves: [['U1'], ['U2']],
      }) + '\n',
    );
    commit(tmp, 'init');

    const result = await runLoop(tmp, config());
    assert.equal(result.exitCode, 0, result.message);
    const session = readSession(tmp);
    assert.equal(session.unitStatus.U1, 'needs-human');
    assert.equal(session.unitStatus.U2, 'complete');
    const handoff = fs.readFileSync(path.join(tmp, 'HANDOFF.md'), 'utf8');
    assert.match(handoff, /Needs human/);
  } finally {
    if (prevFake === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prevFake;
    if (prevWrite === undefined) delete process.env.HARNESS_FAKE_WRITE;
    else process.env.HARNESS_FAKE_WRITE = prevWrite;
    if (prevRoot === undefined) delete process.env.HARNESS_FAKE_ROOT;
    else process.env.HARNESS_FAKE_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
