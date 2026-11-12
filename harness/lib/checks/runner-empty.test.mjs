import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runChecks } from './runner.mjs';

test('A-18 an empty turn diff is no-changes with changes 0', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-empty-'));
  spawnSync('git', ['init'], { cwd: tmp });
  fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
    [
      'sensors:',
      '  - name: ok',
      '    tier: turn',
      '    where: [local, ci]',
      '    blocking: true',
      '    enabled: true',
      '    missing: n/a',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(tmp, 'harness', 'sensors', 'checks', 'ok.sh'), '#!/usr/bin/env bash\necho ok\n');
  fs.writeFileSync(path.join(tmp, 'README'), 'x\n');
  spawnSync('git', ['add', '-A'], { cwd: tmp });
  const committed = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: tmp },
  );
  assert.equal(committed.status, 0, committed.stderr?.toString());
  try {
    const report = await runChecks(tmp, { verify: { failFast: true }, baseline: {} }, { tier: 'turn' });
    assert.equal(report.status, 'no-changes');
    assert.equal(report.changes, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
