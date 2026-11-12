import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPanel } from './dispatch.mjs';
import { readSession } from '../accounting.mjs';

function commit(tmp, message) {
  spawnSync('git', ['add', '-A'], { cwd: tmp });
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', message],
    { cwd: tmp },
  );
  assert.equal(result.status, 0, result.stderr?.toString());
}

function config() {
  return {
    tool: 'cursor',
    profile: 'default',
    roles: { reviewer: { enabled: true } },
    review: {
      blockAt: ['P0', 'P1'],
      cadence: { turn: ['reviewer'] },
      mode: { reviewer: 'blocking' },
    },
    models: {
      profiles: { default: { reviewer: 'deep' } },
      tiers: { deep: { provider: 'anthropic', id: 'fake-model' } },
      providers: { anthropic: { type: 'anthropic' } },
    },
    severity: { style: 'P3', default: 'P2' },
    backlog: { maxItems: 20, promoteAfterUnits: 9 },
  };
}

test('A-41 a disappeared finding is fixed only when its file changed', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outcome-'));
  const prevFake = process.env.HARNESS_FAKE_PROVIDER;
  const prevFindings = process.env.HARNESS_FAKE_FINDINGS;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  try {
    spawnSync('git', ['init'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'changed.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(tmp, 'quiet.js'), 'export const b = 1;\n');
    commit(tmp, 'init');
    fs.writeFileSync(path.join(tmp, 'changed.js'), 'export const a = 2;\n');

    process.env.HARNESS_FAKE_FINDINGS = JSON.stringify([
      { category: 'style', file: 'changed.js', line: 1, message: 'changed' },
      { category: 'style', file: 'quiet.js', line: 1, message: 'quiet' },
    ]);
    await runPanel(tmp, config(), { cadence: 'turn' });

    process.env.HARNESS_FAKE_FINDINGS = '[]';
    await runPanel(tmp, config(), { cadence: 'turn' });

    const findings = readSession(tmp).reviewFindings;
    const changed = findings.find((f) => f.file === 'changed.js');
    const quiet = findings.find((f) => f.file === 'quiet.js');
    assert.equal(changed.outcome, 'fixed');
    assert.equal(quiet.outcome, 'open');
  } finally {
    if (prevFake === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prevFake;
    if (prevFindings === undefined) delete process.env.HARNESS_FAKE_FINDINGS;
    else process.env.HARNESS_FAKE_FINDINGS = prevFindings;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
