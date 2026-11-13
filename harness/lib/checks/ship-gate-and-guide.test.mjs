import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('A-97 the enforce README, the guide, and the failure modes name the pattern limit and the token rule', () => {
  const files = ['harness/enforce/README.md', 'docs/guide.md', 'docs/loop-failure-modes.md'];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, /pattern matching/, rel);
    assert.match(text, /token/, rel);
    assert.match(text, /protected-change/, rel);
  }
});

function between(text, start, end) {
  const at = text.indexOf(start);
  assert.ok(at >= 0, start);
  const next = text.indexOf(end, at + start.length);
  assert.ok(next > at, end);
  return text.slice(at, next);
}

function jsonFences(section) {
  const out = [];
  const parts = section.split('```');
  for (let i = 1; i < parts.length; i += 2) {
    if (!parts[i].startsWith('json')) continue;
    out.push(parts[i].replace(/^json\n/, ''));
  }
  return out;
}

test('A-98 step 5 shows the spec tree, a PRD excerpt, acceptance JSON, and --plan', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'guide.md'), 'utf8');
  const step = between(guide, '## 5. Write a PRD', '## 6. Plan and loop');
  assert.match(step, /specs\/<slug>\//);
  assert.match(step, /## Problem/);
  assert.match(step, /## Behaviour/);
  assert.match(step, /## Non-goals/);
  assert.match(step, /## Acceptance/);
  assert.match(step, /\.\/verify\.sh --plan/);
  const parsed = JSON.parse(jsonFences(step)[0]);
  assert.equal(parsed.entries.length, 2);
  for (const entry of parsed.entries) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.description, 'string');
    assert.equal(entry.passes, false);
    assert.equal(typeof entry.test, 'string');
  }
});

test('A-99 step 13 shows the interview, a failing then passing test, and an ESC entry', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'guide.md'), 'utf8');
  const step = between(guide, '## 13. When a bug escapes', '## 14. Troubleshooting');
  assert.match(step, /What happened/);
  assert.match(step, /How do you reproduce it/);
  assert.match(step, /Which commit is known bad/);
  const failAt = step.indexOf('ℹ fail 1');
  const passAt = step.indexOf('ℹ fail 0');
  assert.ok(failAt >= 0 && passAt > failAt);
  assert.ok(step.indexOf('node --test') < failAt);
  assert.ok(step.lastIndexOf('node --test') > failAt);
  const parsed = JSON.parse(jsonFences(step)[0]);
  assert.match(parsed.id, /^ESC-/);
  assert.equal(typeof parsed.test, 'string');
});

test('A-100 the guide command runner still passes', () => {
  // NODE_TEST* and NODE_CHANNEL* must be removed. Otherwise the nested
  // `node --test` exits 0 in about 30ms without running A-83.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_CHANNEL') || key.startsWith('NODE_TEST')) delete env[key];
  }
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-name-pattern',
      '^A-83 ',
      path.join(ROOT, 'harness', 'lib', 'checks', 'ci-gate-fixes.test.mjs'),
    ],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /A-83/);
});
