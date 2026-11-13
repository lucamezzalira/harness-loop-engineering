import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(ROOT, 'harness', 'lib', 'checks', 'doc-drift.mjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-drift-'));
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, HARNESS_ROOT: root },
    encoding: 'utf8',
  });
}

function commit(root) {
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: root },
  );
  assert.equal(result.status, 0, result.stderr?.toString());
}

test('A-60 doc-drift fails on each of the six drift cases and passes here', () => {
  const flagRoot = tmpDir();
  fs.mkdirSync(path.join(flagRoot, 'harness', 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(flagRoot, 'harness', 'lib', 'cli.mjs'),
    "const ACTION_FLAGS = new Set([\n  '--edit',\n]);\n",
  );
  fs.writeFileSync(
    path.join(flagRoot, 'README.md'),
    '## Commands\n\n| Command | What |\n| --- | --- |\n| `./verify.sh` | commit |\n',
  );
  const flag = run(flagRoot);
  assert.equal(flag.status, 1);
  assert.match(flag.stderr, /--edit/);

  const sensorRoot = tmpDir();
  fs.mkdirSync(path.join(sensorRoot, 'harness', 'sensors'), { recursive: true });
  fs.writeFileSync(
    path.join(sensorRoot, 'harness', 'sensors', 'sensors.yaml'),
    'sensors:\n  - name: ghost\n',
  );
  fs.writeFileSync(path.join(sensorRoot, 'README.md'), '# readme\n');
  const sensor = run(sensorRoot);
  assert.equal(sensor.status, 1);
  assert.match(sensor.stderr, /guidance\/ghost\.md/);

  const mentioned = tmpDir();
  fs.mkdirSync(path.join(mentioned, 'harness', 'sensors', 'guidance'), { recursive: true });
  fs.writeFileSync(
    path.join(mentioned, 'harness', 'sensors', 'sensors.yaml'),
    'sensors:\n  - name: ghost\n',
  );
  fs.writeFileSync(path.join(mentioned, 'harness', 'sensors', 'guidance', 'ghost.md'), '# ghost\n');
  fs.writeFileSync(path.join(mentioned, 'README.md'), '# readme\n');
  const noMention = run(mentioned);
  assert.equal(noMention.status, 1);
  assert.match(noMention.stderr, /not mentioned in the README/);

  const roleRoot = tmpDir();
  fs.mkdirSync(path.join(roleRoot, 'harness', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(roleRoot, 'harness.yaml'), 'roles:\n  reviewer: { enabled: true }\n');
  fs.writeFileSync(path.join(roleRoot, 'harness', 'roles', 'README.md'), '# roles\n');
  const role = run(roleRoot);
  assert.equal(role.status, 1);
  assert.match(role.stderr, /reviewer/);

  const skillRoot = tmpDir();
  fs.mkdirSync(path.join(skillRoot, 'harness', 'skills', 'orphan'), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'harness', 'skills', 'orphan', 'SKILL.md'), '# orphan\n');
  fs.writeFileSync(path.join(skillRoot, 'README.md'), '# readme\n');
  const skill = run(skillRoot);
  assert.equal(skill.status, 1);
  assert.match(skill.stderr, /orphan/);

  const keyRoot = tmpDir();
  fs.writeFileSync(path.join(keyRoot, 'harness.yaml'), 'project:\n  name: demo\n');
  fs.writeFileSync(
    path.join(keyRoot, 'README.md'),
    '## Configuration\n\nNo keys are described here.\n',
  );
  const key = run(keyRoot);
  assert.equal(key.status, 1);
  assert.match(key.stderr, /project/);

  const linkRoot = tmpDir();
  fs.writeFileSync(path.join(linkRoot, 'README.md'), '[gone](missing.md)\n');
  commit(linkRoot);
  const link = run(linkRoot);
  assert.equal(link.status, 1);
  assert.match(link.stderr, /missing\.md/);

  const live = run(ROOT);
  assert.equal(live.status, 0, live.stderr);

  for (const dir of [flagRoot, sensorRoot, mentioned, roleRoot, skillRoot, keyRoot, linkRoot]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A-61 the retired host name in the docs is only the accepted ADR allowlist', () => {
  const needle = 'co' + 'dex';
  const listed = spawnSync('grep', ['-ri', '-n', needle, 'docs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const lines = (listed.stdout || '').split('\n').filter(Boolean);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.match(line, /docs\/adr\/000[146]-/);
  }
});

test('A-62 AGENTS.md names the state boundary and stays within the line limit', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /never runs `--allow-check-edit`/);
  assert.match(agents, /never writes `harness\/state\/`/);
  const config = parseYaml(fs.readFileSync(path.join(ROOT, 'harness.yaml'), 'utf8'));
  const limit = config.limits.agentsMdLines;
  assert.ok(agents.split('\n').length <= limit);
  const budget = spawnSync(
    'bash',
    [path.join(ROOT, 'harness', 'sensors', 'checks', 'context-budget.sh')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        HARNESS_ROOT: ROOT,
        HARNESS_CONFIG_JSON: JSON.stringify(config),
      },
      encoding: 'utf8',
    },
  );
  assert.equal(budget.status, 0, budget.stderr || budget.stdout);
});

test('A-63 the README What changed section links the three specs and their reports', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const at = readme.indexOf('## What changed');
  assert.ok(at >= 0);
  const body = readme.slice(at);
  assert.match(body, /pull\/2/);
  assert.match(body, /pull\/3/);
  assert.match(body, /pull\/4/);
  for (const slug of ['align-harness-with-course', 'followup-fixes', 'close-the-gaps']) {
    assert.ok(body.includes(`specs/${slug}/`), slug);
    assert.ok(body.includes(`specs/${slug}/REPORT.md`), slug);
  }
});
