import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DRIFT = path.join(ROOT, 'harness', 'lib', 'checks', 'doc-drift.mjs');

const BANNED = ['cannot commit ' + 'on its own', 'can' + "'t skip"];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) walk(abs, out);
    else if (stat.isFile() && stat.size < 2_000_000) out.push(abs);
  }
}

test('A-114 a setting without a cited URL fails doc-drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-drift-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'platform-gates.md'),
    '- **Require a pull request before merging** stops a direct push\n',
  );
  const ran = spawnSync(process.execPath, [DRIFT], {
    cwd: root,
    env: { ...process.env, HARNESS_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /Require a pull request before merging/);
  assert.match(ran.stderr, /no cited doc URL/);
});

test('A-115 the repo does not say the agent is unable to commit or that a check is unskippable', () => {
  const files = [];
  walk(ROOT, files);
  const hits = [];
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    for (const phrase of BANNED) {
      if (text.includes(phrase)) hits.push(`${path.relative(ROOT, file)}: ${phrase}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('A-116 every failure-mode row says whether it prevents or warns', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'loop-failure-modes.md'), 'utf8');
  const table = text.split('## Config knobs')[0];
  const rows = table.split('\n').filter((line) => line.startsWith('|') && !line.includes('---'));
  assert.match(rows[0], /Prevents or warns/);
  const warns = [
    'The agent edits checks',
    'Agent self-approves a check edit',
    'Agent labels, reviews, or merges',
    'Short review flags',
    'GraphQL mutation',
    'HTTP client to the GitHub API',
  ];
  for (const row of rows.slice(1)) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const effect = cells[cells.length - 1];
    assert.ok(effect === 'prevents' || effect === 'warns', row.slice(0, 80));
    const name = cells[0];
    if (warns.some((item) => name.includes(item))) assert.equal(effect, 'warns', name);
  }
});

test('A-117 doc-drift stays green and the README keeps review advisory', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cwd-'));
  const ran = spawnSync(process.execPath, [DRIFT], {
    cwd,
    env: { ...process.env, HARNESS_ROOT: ROOT },
    encoding: 'utf8',
  });
  assert.equal(ran.status, 0, ran.stderr);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /review panel and any hosted AI reviewer are advisory/);
  assert.match(readme, /Their approval never counts/);
  assert.match(
    readme,
    /https:\/\/labs\.cloudsecurityalliance\.org\/research\/csa-research-note-ghostcommit-image-prompt-injection-ai-code\//,
  );
});
