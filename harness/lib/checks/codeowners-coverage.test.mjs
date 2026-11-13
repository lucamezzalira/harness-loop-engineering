import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.mjs';
import { globsToCover } from './codeowners.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SENSOR = path.join(ROOT, 'harness', 'sensors', 'checks', 'codeowners-coverage.sh');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');

function run(root) {
  return spawnSync('bash', [SENSOR], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: root },
  });
}

test('A-73 CODEOWNERS covers every protected glob and itself', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'CODEOWNERS'), 'utf8');
  assert.match(text, /@lucamezzalira/);
  assert.match(text, /^\.github\/CODEOWNERS @lucamezzalira$/m);
  const globs = globsToCover(loadConfig(ROOT));
  for (const glob of globs) {
    assert.ok(text.includes(glob), glob);
  }
  const live = run(ROOT);
  assert.equal(live.status, 0, live.stderr || live.stdout);
});

test('A-74 codeowners-coverage fails when a protected glob has no owner and passes here', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-owners-'));
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    [
      'protect:',
      '  checkPaths:',
      '    - owned.txt',
      '    - missing.txt',
      'review:',
      '  humanRequired:',
      '    paths:',
      '      - owned.txt',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'owned.txt @ada\n');
  const failed = run(root);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /missing\.txt/);
  const live = run(ROOT);
  assert.equal(live.status, 0, live.stderr || live.stdout);
  fs.rmSync(root, { recursive: true, force: true });
});

test('A-75 --install leaves an existing CODEOWNERS byte-identical and reports uncovered globs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-install-'));
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.mkdirSync(path.join(root, 'harness', 'sensors', 'checks'), { recursive: true });
  const owners = 'owned.txt @ada\n';
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), owners);
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    [
      'protect:',
      '  checkPaths:',
      '    - owned.txt',
      '    - missing.txt',
      'review:',
      '  humanRequired:',
      '    paths:',
      '      - owned.txt',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(root, 'harness.local.yaml'), 'tool: cursor\nprofile: default\n');
  fs.writeFileSync(
    path.join(root, 'harness', 'sensors', 'sensors.yaml'),
    [
      'sensors:',
      '  - name: ok',
      '    tier: edit',
      '    where: [local, ci]',
      '    blocking: true',
      '    enabled: true',
      '    missing: n/a',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, 'harness', 'sensors', 'checks', 'ok.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  spawnSync('git', ['init'], { cwd: root });
  const before = fs.readFileSync(path.join(root, '.github', 'CODEOWNERS'));
  const ran = spawnSync(process.execPath, [CLI, '--install'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: root },
    timeout: 60000,
  });
  const after = fs.readFileSync(path.join(root, '.github', 'CODEOWNERS'));
  assert.equal(before.equals(after), true);
  assert.match(ran.stdout, /CODEOWNERS uncovered:.*missing\.txt/);
  fs.rmSync(root, { recursive: true, force: true });
});
