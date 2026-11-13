import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(ROOT, 'harness', 'lib', 'checks', 'report-present.mjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-report-'));
}

function writeAcceptance(root, passes) {
  const dir = path.join(root, 'specs', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'acceptance.json'),
    JSON.stringify({ entries: [{ id: 'A-01', passes, test: 'demo.test.mjs' }] }) + '\n',
  );
  return dir;
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, HARNESS_ROOT: root },
    encoding: 'utf8',
  });
}

test('A-58 report-present fails without a PASS report and passes with one', () => {
  const root = tmpDir();
  writeAcceptance(root, true);
  const missing = run(root);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /REPORT.md is missing/);

  const dir = path.join(root, 'specs', 'demo');
  fs.writeFileSync(path.join(dir, 'REPORT.md'), 'Notes.\n\nacceptance-checker: FAIL\n');
  const failed = run(root);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /does not end in acceptance-checker: PASS/);

  fs.writeFileSync(path.join(dir, 'REPORT.md'), 'Notes.\n\nacceptance-checker: PASS\n');
  const passed = run(root);
  assert.equal(passed.status, 0, passed.stderr);

  const open = tmpDir();
  writeAcceptance(open, false);
  const ignored = run(open);
  assert.equal(ignored.status, 0, ignored.stderr);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(open, { recursive: true, force: true });
});

test('A-59 the three reports end in PASS and report-present is green', () => {
  for (const slug of ['align-harness-with-course', 'followup-fixes', 'close-the-gaps']) {
    const text = fs.readFileSync(path.join(ROOT, 'specs', slug, 'REPORT.md'), 'utf8').trim();
    assert.ok(text.endsWith('acceptance-checker: PASS'), slug);
  }
  const live = run(ROOT);
  assert.equal(live.status, 0, live.stderr);
});
