import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowCheckEdit } from './allow-check-edit.mjs';
import { preTool } from './pre_tool.mjs';
import { evaluateCheckIntegrity } from '../checks/check-integrity.mjs';
import { CHECK_EDIT_TTL_MS } from './check-edit-record.mjs';
import { renderReport } from '../accounting.mjs';
import { runLoop } from '../plan/loop.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-allow-'));
}

function liveRecord(paths, extra = {}) {
  return {
    id: 's',
    explicitCheckEdit: {
      paths,
      reason: extra.reason || 'cover the config',
      at: extra.at || new Date().toISOString(),
      by: 'Test User',
      sessionId: extra.sessionId || 's',
    },
  };
}

test('A-35 --allow-check-edit without a TTY exits 2 and writes nothing', async () => {
  const tmp = tmpDir();
  const session = path.join(tmp, 'harness', 'state', 'session.json');
  const log = path.join(tmp, 'harness', 'state', 'check-edits.log');
  const spawned = spawnSync(process.execPath, [CLI, '--allow-check-edit'], {
    cwd: ROOT,
    env: { ...process.env, HARNESS_ROOT: tmp, HARNESS_IN_HOOK: '0' },
    encoding: 'utf8',
  });
  assert.equal(spawned.status, 2, spawned.stderr || spawned.stdout);
  assert.equal(fs.existsSync(session), false);
  assert.equal(fs.existsSync(log), false);

  const prev = process.env.HARNESS_IN_HOOK;
  process.env.HARNESS_IN_HOOK = '1';
  try {
    const hooked = await allowCheckEdit(tmp, {
      isTTY: () => true,
      ask: async () => 'all',
    });
    assert.equal(hooked.exitCode, 2);
    assert.equal(fs.existsSync(session), false);
    assert.equal(fs.existsSync(log), false);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_IN_HOOK;
    else process.env.HARNESS_IN_HOOK = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('A-36 a simulated TTY records harness.yaml and pre_tool honours that glob', async () => {
  const tmp = tmpDir();
  const answers = ['harness.yaml', 'cover the config'];
  const recorded = await allowCheckEdit(tmp, {
    isTTY: () => true,
    by: 'Test User',
    ask: async () => answers.shift(),
  });
  assert.equal(recorded.exitCode, 0);
  const session = JSON.parse(
    fs.readFileSync(path.join(tmp, 'harness', 'state', 'session.json'), 'utf8'),
  );
  assert.deepEqual(session.explicitCheckEdit.paths, ['harness.yaml']);
  assert.equal(session.explicitCheckEdit.by, 'Test User');
  assert.match(
    fs.readFileSync(path.join(tmp, 'harness', 'state', 'check-edits.log'), 'utf8'),
    /cover the config/,
  );

  const yaml = preTool(tmp, {
    tool_name: 'Write',
    tool_input: { path: path.join(tmp, 'harness.yaml'), contents: 'x: 1\n' },
  });
  assert.equal(yaml.allow, true);
  const sensor = preTool(tmp, {
    tool_name: 'Write',
    tool_input: { path: path.join(tmp, 'harness/sensors/checks/unit.sh'), contents: 'echo\n' },
  });
  assert.equal(sensor.allow, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-37 check-integrity allows only the recorded protected paths', () => {
  const session = liveRecord(['harness.yaml']);
  const only = evaluateCheckIntegrity({
    nameStatus: ['M\tharness.yaml'],
    session,
  });
  assert.equal(only.exitCode, 0);
  const extra = evaluateCheckIntegrity({
    nameStatus: ['M\tharness.yaml', 'M\tharness/sensors/checks/unit.sh'],
    session,
  });
  assert.equal(extra.exitCode, 1);
  assert.match(extra.findings.map((f) => f.file).join('\n'), /unit\.sh/);
});

test('A-38 an expired record or a previous session id is ignored', () => {
  const old = liveRecord(['harness.yaml'], {
    at: new Date(Date.now() - CHECK_EDIT_TTL_MS - 60_000).toISOString(),
  });
  const expired = evaluateCheckIntegrity({
    nameStatus: ['M\tharness.yaml'],
    session: old,
    now: Date.now(),
  });
  assert.equal(expired.exitCode, 1);

  const other = liveRecord(['harness.yaml'], { sessionId: 'previous' });
  const stale = evaluateCheckIntegrity({
    nameStatus: ['M\tharness.yaml'],
    session: other,
  });
  assert.equal(stale.exitCode, 1);
});

function commit(tmp, message) {
  spawnSync('git', ['add', '-A'], { cwd: tmp });
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', message],
    { cwd: tmp },
  );
  assert.equal(result.status, 0, result.stderr?.toString() || 'commit failed');
}

function loopConfig() {
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
      cadence: { ship: ['reviewer'], unit: ['reviewer'], turn: ['reviewer'] },
    },
    models: {
      profiles: { default: { reviewer: 'deep', planner: 'deep' } },
      tiers: { deep: { provider: 'anthropic', id: 'fake-model' } },
      providers: { anthropic: { type: 'anthropic' } },
    },
    severity: { style: 'P3', default: 'P2' },
    backlog: { maxItems: 10, promoteAfterUnits: 3 },
    loop: {
      prd: 'specs/demo/PRD.md',
      maxTurns: 4,
      maxSeconds: 60,
      maxCostUsd: 5,
      gate: 'never',
      stopOnIdenticalFailures: 2,
    },
  };
}

test('A-39 the authorisation is in --report and the wave retro', async () => {
  const tmp = tmpDir();
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  try {
    spawnSync('git', ['init'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'harness/state/\nharness/retro/\n');
    fs.mkdirSync(path.join(tmp, 'specs', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', 'demo', 'PRD.md'), '# demo\n');
    fs.writeFileSync(
      path.join(tmp, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({ entries: [{ id: 'A-01', passes: true, test: 'specs/demo/ok.test.mjs' }] }) +
        '\n',
    );
    fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
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
    commit(tmp, 'init');

    const answers = ['harness.yaml', 'cover the config'];
    const recorded = await allowCheckEdit(tmp, {
      isTTY: () => true,
      by: 'Test User',
      ask: async () => answers.shift(),
    });
    assert.equal(recorded.exitCode, 0);
    const report = renderReport(tmp);
    assert.match(report, /cover the config/);

    fs.writeFileSync(
      path.join(tmp, 'harness', 'state', 'plan.json'),
      JSON.stringify({
        units: [
          {
            id: 'U1',
            title: 'docs',
            touches: ['specs/demo/**'],
            acceptance: ['A-01'],
            estimatedTurns: 1,
          },
        ],
        waves: [['U1']],
      }) + '\n',
    );
    const result = await runLoop(tmp, loopConfig(), { resume: true });
    assert.equal(result.exitCode, 0, result.message);
    const session = JSON.parse(
      fs.readFileSync(path.join(tmp, 'harness', 'state', 'session.json'), 'utf8'),
    );
    const retro = fs.readFileSync(
      path.join(tmp, 'harness', 'retro', session.id, 'wave-1.md'),
      'utf8',
    );
    assert.match(retro, /## Deterministic/);
    assert.match(retro, /cover the config/);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
