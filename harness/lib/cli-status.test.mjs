import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');

function status(root) {
  return spawnSync(process.execPath, [CLI, '--status'], {
    cwd: ROOT,
    env: { ...process.env, HARNESS_ROOT: root },
    encoding: 'utf8',
  });
}

test('A-44 --status prints humanRequired.paths and a local override replaces them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-status-'));
  fs.writeFileSync(path.join(tmp, 'harness.local.yaml'), 'tool: cursor\n');
  const base = status(tmp);
  assert.equal(base.status, 0, base.stderr);
  assert.match(base.stdout, /humanRequired\.paths: .*harness\/\*\*/);

  fs.writeFileSync(
    path.join(tmp, 'harness.local.yaml'),
    [
      'tool: cursor',
      'review:',
      '  humanRequired:',
      '    paths:',
      "      - 'services/orders/**'",
      '',
    ].join('\n'),
  );
  const over = status(tmp);
  assert.equal(over.status, 0, over.stderr);
  assert.match(over.stdout, /humanRequired\.paths: services\/orders\/\*\*/);
  assert.doesNotMatch(over.stdout, /humanRequired\.paths: .*harness\/\*\*/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-45 the README explains the default, why harness/** is there, and the local override', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const section = readme.split('## Paths that need a person')[1]?.split('## ')[0] || '';
  assert.match(section, /harness\/\*\*/);
  assert.match(section, /consuming repo/);
  assert.match(section, /harness\.local\.yaml/);
  assert.match(section, /humanRequired/);
  assert.match(section, /--allow-check-edit/);
});
