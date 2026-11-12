import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');

test('A-46 format, lint and types are installed and do not skip', () => {
  const config = loadConfig(ROOT);
  const env = {
    ...process.env,
    HARNESS_CHANGED_FILES: '',
    HARNESS_ROOT: ROOT,
    HARNESS_BASELINE_JSON: JSON.stringify(config.baseline || {}),
    HARNESS_CONFIG_JSON: JSON.stringify(config),
  };
  for (const name of ['format', 'lint', 'types']) {
    const script = path.join(ROOT, 'harness', 'sensors', 'checks', `${name}.sh`);
    const result = spawnSync('bash', [script], { cwd: ROOT, env, encoding: 'utf8' });
    assert.notEqual(result.status, 3, `${name} skipped\n${result.stderr}`);
    assert.equal(result.status, 0, `${name} failed\n${result.stdout}\n${result.stderr}`);
  }
});

test('A-48 each tier summary names the skipped sensor', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-skip-'));
  fs.writeFileSync(path.join(tmp, 'harness.local.yaml'), 'tool: cursor\n');
  fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'harness', 'sensors', 'checks', 'ghost.sh'),
    '#!/usr/bin/env bash\necho "tool not installed" >&2\nexit 3\n',
  );
  fs.writeFileSync(
    path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
    [
      'sensors:',
      '  - name: ghost',
      '    tier: edit',
      '    where: [local, ci]',
      '    blocking: true',
      '    enabled: true',
      '    missing: skip',
      '',
    ].join('\n'),
  );
  for (const flag of [['--edit'], ['--turn'], []]) {
    const result = spawnSync(process.execPath, [CLI, ...flag], {
      cwd: ROOT,
      env: { ...process.env, HARNESS_ROOT: tmp },
      encoding: 'utf8',
    });
    const text = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, text);
    assert.match(text, /skipped \(tool missing\): ghost/);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
