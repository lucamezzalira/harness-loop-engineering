import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORT = path.join(ROOT, 'harness', 'lib', 'checks', 'report-present.mjs');
const COVERAGE = path.join(ROOT, 'harness', 'lib', 'checks', 'codeowners-coverage.mjs');
const DRIFT = path.join(ROOT, 'harness', 'lib', 'checks', 'doc-drift.mjs');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(script, root) {
  return spawnSync(process.execPath, [script], {
    cwd: tmpDir('harness-cwd-'),
    env: { ...process.env, HARNESS_ROOT: root },
    encoding: 'utf8',
  });
}

function walkTests(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) {
      if (name === 'node_modules') continue;
      walkTests(abs, out);
    } else if (name.endsWith('.test.mjs')) out.push(abs);
  }
  return out;
}

test('A-84 no test spawns the CLI at the real repo root', () => {
  const files = walkTests(ROOT, []);
  const hits = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let from = 0;
    while (from < source.length) {
      const at = source.slice(from).search(/spawn(?:Sync)?\(/);
      if (at < 0) break;
      const start = from + at;
      const slice = source.slice(start, start + 900);
      const end = slice.indexOf(';');
      const call = end < 0 ? slice : slice.slice(0, end);
      const isCli = call.includes('cli.mjs') || call.includes('verify.sh');
      if (isCli && /cwd:\s*ROOT\b/.test(call)) hits.push(path.relative(ROOT, file));
      from = start + 8;
    }
  }
  assert.deepEqual(hits, []);
});

test('A-85 and A-86 the clean-clone test step runs first and verify waits for the label job', () => {
  const doc = parseYaml(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const verify = doc.jobs.verify;
  const needs = Array.isArray(verify.needs) ? verify.needs : [verify.needs];
  assert.ok(needs.includes('clear-protected-label'));
  assert.equal(verify.if, 'always()');
  const steps = verify.steps;
  const unit = steps.findIndex((step) => step.name === 'Unit tests (no local config)');
  const write = steps.findIndex((step) =>
    String(step.run || '').includes('cp harness.local.yaml.example'),
  );
  assert.ok(unit >= 0);
  assert.ok(write > unit);
  assert.match(steps[unit].run, /npm test/);
});

test('A-90 harness/** is the first harness rule in CODEOWNERS', () => {
  const lines = fs
    .readFileSync(path.join(ROOT, '.github', 'CODEOWNERS'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const harness = lines.filter((line) => line.startsWith('harness/'));
  assert.equal(harness[0].startsWith('harness/**'), true);
  assert.ok(harness.length > 1);
});

test('A-91 a broad glob after a specific one fails, and this tree passes', () => {
  const root = tmpDir('harness-owners-');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    'review:\n  humanRequired:\n    paths:\n      - harness/sensors/**\n',
  );
  fs.writeFileSync(
    path.join(root, '.github', 'CODEOWNERS'),
    'harness/sensors/** @solo\nharness/** @solo\n',
  );
  const bad = runNode(COVERAGE, root);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /harness\/\*\* comes after harness\/sensors\/\*\*/);
  const live = runNode(COVERAGE, ROOT);
  assert.equal(live.status, 0, live.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSpec(root, prd, entries, report) {
  const dir = path.join(root, 'specs', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PRD.md'), prd);
  fs.writeFileSync(path.join(dir, 'acceptance.json'), JSON.stringify({ entries }) + '\n');
  if (report != null) fs.writeFileSync(path.join(dir, 'REPORT.md'), report);
  return dir;
}

const SIX = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'].map((id) => `- ${id}: required`).join('\n');

test('A-92 a partial acceptance file fails and names the missing ids', () => {
  const root = tmpDir('harness-report-');
  writeSpec(
    root,
    `# Demo\n\n${SIX}\n`,
    ['A-1', 'A-2', 'A-3', 'A-4'].map((id) => ({ id, passes: true, test: 't.mjs' })),
    null,
  );
  const result = runNode(REPORT, root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /A-5/);
  assert.match(result.stderr, /A-6/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('A-93 deferred ids pass, and dropping one deferred line fails again', () => {
  const root = tmpDir('harness-report-');
  const entries = ['A-1', 'A-2', 'A-3', 'A-4'].map((id) => ({
    id,
    passes: true,
    test: 't.mjs',
  }));
  const report = [
    '## Criteria',
    '',
    '| id |',
    '| --- |',
    '| A-1 |',
    '| A-2 |',
    '| A-3 |',
    '| A-4 |',
    '',
    '## Wiring proof',
    '',
    'none',
    '',
    'acceptance-checker: PASS',
    '',
  ].join('\n');
  const dir = writeSpec(
    root,
    `# Demo\n\n${SIX}\n\nDeferred: A-5 (later)\nDeferred: A-6 (later)\n`,
    entries,
    report,
  );
  const passed = runNode(REPORT, root);
  assert.equal(passed.status, 0, passed.stderr);
  fs.writeFileSync(path.join(dir, 'PRD.md'), `# Demo\n\n${SIX}\n\nDeferred: A-5 (later)\n`);
  const failed = runNode(REPORT, root);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /A-6/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('A-94 report-present is green and the gate spec lists every id through A-83', () => {
  const live = runNode(REPORT, ROOT);
  assert.equal(live.status, 0, live.stderr);
  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'specs', 'ci-is-the-gate', 'acceptance.json'), 'utf8'),
  );
  const ids = data.entries.map((entry) => entry.id);
  for (let n = 64; n <= 83; n += 1) {
    const id = `A-${n}`;
    assert.ok(ids.includes(id), id);
    assert.equal(data.entries.find((entry) => entry.id === id).passes, true, id);
  }
});

test('A-78 ADR 0007 is indexed and passes adr-frontmatter', () => {
  const file = path.join(ROOT, 'docs', 'adr', '0007-ci-decides-protected-changes.md');
  assert.equal(fs.existsSync(file), true);
  const index = fs.readFileSync(path.join(ROOT, 'docs', 'adr', 'README.md'), 'utf8');
  assert.match(index, /0007-ci-decides-protected-changes\.md/);
  const check = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-adr-frontmatter.mjs')],
    {
      cwd: tmpDir('harness-adr-'),
      env: { ...process.env, HARNESS_ROOT: ROOT },
      encoding: 'utf8',
    },
  );
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('A-79 the README trust-model section names the gate, the label, and the caveat', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const at = readme.indexOf('## Trust model');
  assert.ok(at >= 0);
  const body = readme.slice(at, readme.indexOf('\n## ', at + 4));
  assert.match(body, /protected-change/);
  assert.match(body, /protected-change-approved/);
  assert.match(body, /clear/);
  assert.match(body, /branch protection/i);
});

test('A-81 the guide has the fourteen steps and the README links it immediately', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'guide.md'), 'utf8');
  const titles = [
    'Prerequisites',
    'Install into a repo',
    'Pick your tool and render',
    'First check run',
    'Write a PRD',
    'Plan and loop',
    'Review',
    'Backlog triage',
    'Changing a check',
    'Shipping',
    'After the run',
    'Finishing a spec',
    'When a bug escapes',
    'Troubleshooting',
  ];
  let from = 0;
  for (const title of titles) {
    const at = guide.indexOf(`## ${titles.indexOf(title) + 1}. ${title}`, from);
    assert.ok(at > from, title);
    from = at + 1;
  }
  const head = fs
    .readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    .split('\n')
    .slice(0, 40)
    .join('\n');
  assert.match(head, /docs\/guide\.md/);
});

test('A-82 doc-drift fails the three guide cases and passes here', () => {
  const unknown = tmpDir('harness-guide-');
  fs.mkdirSync(path.join(unknown, 'harness', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(unknown, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(unknown, 'harness', 'lib', 'cli.mjs'),
    "const ACTION_FLAGS = new Set([\n  '--edit',\n]);\n",
  );
  fs.writeFileSync(
    path.join(unknown, 'README.md'),
    '[guide](docs/guide.md)\n\n## Commands\n\n`--edit`\n',
  );
  fs.writeFileSync(
    path.join(unknown, 'docs', 'guide.md'),
    '```bash\n./verify.sh --nope\n```\n\n`--edit`\n',
  );
  const badFlag = runNode(DRIFT, unknown);
  assert.equal(badFlag.status, 1, badFlag.stderr);
  assert.match(badFlag.stderr, /--nope/);

  const missing = tmpDir('harness-guide-');
  fs.mkdirSync(path.join(missing, 'harness', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(missing, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(missing, 'harness', 'lib', 'cli.mjs'),
    "const ACTION_FLAGS = new Set([\n  '--edit',\n  '--turn',\n]);\n",
  );
  fs.writeFileSync(
    path.join(missing, 'README.md'),
    '[guide](docs/guide.md)\n\n## Commands\n\n`--edit` `--turn`\n',
  );
  fs.writeFileSync(path.join(missing, 'docs', 'guide.md'), 'Use `--edit`.\n');
  const missed = runNode(DRIFT, missing);
  assert.equal(missed.status, 1, missed.stderr);
  assert.match(missed.stderr, /--turn/);

  const unlinked = tmpDir('harness-guide-');
  fs.mkdirSync(path.join(unlinked, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(unlinked, 'README.md'), '# readme\n');
  fs.writeFileSync(path.join(unlinked, 'docs', 'guide.md'), '# guide\n');
  const link = runNode(DRIFT, unlinked);
  assert.equal(link.status, 1, link.stderr);
  assert.match(link.stderr, /first 40 lines/);

  const live = runNode(DRIFT, ROOT);
  assert.equal(live.status, 0, live.stderr);
  fs.rmSync(unknown, { recursive: true, force: true });
  fs.rmSync(missing, { recursive: true, force: true });
  fs.rmSync(unlinked, { recursive: true, force: true });
});

function guideCommands() {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'guide.md'), 'utf8');
  const commands = [];
  const parts = guide.split('```');
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i].replace(/^[^\n]*\n/, '');
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('./verify.sh')) commands.push(trimmed);
    }
  }
  return commands;
}

function guideRepo() {
  const root = tmpDir('harness-guide-run-');
  fs.writeFileSync(path.join(root, 'harness.local.yaml'), 'tool: cursor\n');
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    'loop:\n  prd: specs/demo/PRD.md\n  maxTurns: 2\n',
  );
  fs.mkdirSync(path.join(root, 'specs', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'demo', 'PRD.md'), '# Demo\n');
  fs.mkdirSync(path.join(root, 'harness', 'sensors', 'checks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness', 'models.yaml'),
    'providers: {}\ntiers: {}\nprofiles:\n  default: {}\n',
  );
  fs.writeFileSync(
    path.join(root, 'harness', 'sensors', 'sensors.yaml'),
    [
      'sensors:',
      '  - name: ok',
      '    tier: commit',
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
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: root },
  );
  return root;
}

test('A-83 guide commands run in a fixture without exit 2', () => {
  const commands = guideCommands();
  assert.ok(commands.length > 0);
  const root = guideRepo();
  const helpOnly = ['--loop', '--install', '--allow-check-edit'];
  try {
    for (const command of commands) {
      const args = command
        .replace(/^\.\/verify\.sh\s*/, '')
        .split(/\s+/)
        .filter(Boolean);
      const exception = helpOnly.some((flag) => args.includes(flag));
      const argv = exception ? ['--help'] : args;
      const result = spawnSync(process.execPath, [CLI, ...argv], {
        cwd: root,
        env: {
          ...process.env,
          HARNESS_ROOT: root,
          HARNESS_FAKE_PROVIDER: '1',
          HARNESS_ENV: 'local',
        },
        encoding: 'utf8',
        timeout: 20000,
      });
      assert.notEqual(result.status, 2, `${command}\n${result.stdout}\n${result.stderr}`);
      if (exception) assert.equal(result.status, 0, command);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
