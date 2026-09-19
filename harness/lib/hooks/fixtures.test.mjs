import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function runThin(script, payload) {
  const scriptPath = path.join(ROOT, '.cursor', 'hooks', script);
  assert.ok(fs.existsSync(scriptPath), `missing ${scriptPath}; run ./verify.sh --render first`);
  return spawnSync('bash', [scriptPath], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: ROOT },
  });
}

test('before-shell allows ls', () => {
  const r = runThin('before-shell.sh', { command: 'ls -la' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.permission, 'allow');
});

test('before-shell denies rm -rf with exit 2', () => {
  const r = runThin('before-shell.sh', { command: 'rm -rf /tmp/x' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.permission, 'deny');
});

test('before-shell denies agent git commit with exit 2', () => {
  const r = runThin('before-shell.sh', { command: 'git commit -m "x"' });
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.permission, 'deny');
});

test('after-edit never exits non-zero', () => {
  const r = runThin('after-edit.sh', {
    file_path: path.join(ROOT, 'package.json'),
    edits: [],
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.moment, 'afterFileEdit');
});

test('session-start returns treeHash', () => {
  const r = runThin('session-start.sh', {});
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.ok(out.treeHash);
});

test('BOM-prefixed JSON still parses in --hook', () => {
  const bom = '\uFEFF' + JSON.stringify({ moment: 'beforeShellExecution', command: 'echo hi' });
  const r = spawnSync('bash', [path.join(ROOT, 'verify.sh'), '--hook'], {
    cwd: ROOT,
    input: bom,
    encoding: 'utf8',
    env: {
      ...process.env,
      HARNESS_ROOT: ROOT,
      HARNESS_IN_HOOK: '1',
      HARNESS_HOOK_MOMENT: 'beforeShellExecution',
    },
  });
  assert.equal(r.status, 0, r.stderr);
});

test('thin adapter scripts do not invoke a runtime binary', () => {
  const dir = path.join(ROOT, 'harness', 'render', 'cursor', 'hooks');
  for (const name of fs.readdirSync(dir)) {
    assert.ok(name.endsWith('.sh'), `adapter should be shell-only, found ${name}`);
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    // Strip comments before scanning for runtimes
    const code = body
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    assert.ok(!/\bnode\b/i.test(code), `${name} must not invoke node`);
    assert.ok(!/\bpython\b/i.test(code), `${name} must not invoke python`);
    assert.ok(code.includes('verify.sh'), `${name} must call verify.sh`);
  }
});
