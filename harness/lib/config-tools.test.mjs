import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const retired = 'co' + 'dex';

test('A-22 the retired host name survives only in the two historical ADRs', () => {
  const result = spawnSync(
    'grep',
    ['-R', '-i', '-n', '--exclude-dir=node_modules', '--exclude-dir=.git', '-e', retired, '.'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const lines = (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes(`${path.sep}docs${path.sep}adr${path.sep}0001-`) && !line.includes('/docs/adr/0001-'))
    .filter((line) => !line.includes(`${path.sep}docs${path.sep}adr${path.sep}0004-`) && !line.includes('/docs/adr/0004-'));
  assert.deepEqual(lines, [], lines.join('\n'));
});

test('A-24 CI still runs the test suite and the verify entry point', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm test/);
  assert.match(ci, /verify\.sh/);
  assert.equal(ci.toLowerCase().includes(retired), false);
});

test('A-23 a config that names the retired host exits 2', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tool-'));
  fs.writeFileSync(path.join(tmp, 'harness.local.yaml'), `tool: ${retired}\nprofile: default\n`);
  try {
    assert.throws(
      () => loadConfig(tmp),
      (err) => {
        assert.equal(err.exitCode, 2);
        assert.equal(err.message, `${retired} is not supported; set tool: cursor or tool: claude`);
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
