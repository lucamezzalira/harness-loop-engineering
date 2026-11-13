import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_ENV_MARKERS, allowCheckEdit } from './allow-check-edit.mjs';
import { newAdhocSession } from './adhoc-session.mjs';
import { resolveHarnessEnv } from '../checks/common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');
const INTEGRITY = path.join(ROOT, 'harness', 'lib', 'checks', 'check-integrity.mjs');

function developerEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of AGENT_ENV_MARKERS) delete env[name];
  delete env.HARNESS_IN_HOOK;
  return { ...env, ...extra };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-state-'));
}

function hook(payload) {
  return spawnSync(process.execPath, [CLI, '--hook'], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: ROOT, HARNESS_IN_HOOK: '1' },
  });
}

function configRoot() {
  const tmp = tmpDir();
  fs.writeFileSync(path.join(tmp, 'harness.local.yaml'), 'tool: claude\nprofile: default\n');
  return tmp;
}

function runPty(args, env, input) {
  const py = [
    'import json, os, pty, select, sys, time',
    'node = os.environ["PTY_NODE"]',
    'args = json.loads(os.environ["PTY_ARGS"])',
    'payload = sys.stdin.buffer.read()',
    'pending = [line + b"\\n" for line in payload.split(b"\\n") if line]',
    'pid, fd = pty.fork()',
    'if pid == 0:',
    '    os.execv(node, [node, *args])',
    'out = b""',
    'sent = 0',
    'deadline = time.time() + 8',
    'code = 1',
    'while time.time() < deadline:',
    '    ready, _, _ = select.select([fd], [], [], 0.2)',
    '    if ready:',
    '        try:',
    '            chunk = os.read(fd, 4096)',
    '        except OSError:',
    '            chunk = b""',
    '        if chunk:',
    '            out += chunk',
    '        else:',
    '            wpid, status = os.waitpid(pid, 0)',
    '            code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1',
    '            break',
    '    if sent == 0 and pending and b"Which protected paths?" in out:',
    '        os.write(fd, pending[0])',
    '        sent = 1',
    '    elif sent == 1 and len(pending) > 1 and b"One-line reason" in out:',
    '        os.write(fd, pending[1])',
    '        sent = 2',
    '    elif b"keep, discard, or promote?" in out and sent < len(pending):',
    '        os.write(fd, pending[sent])',
    '        sent += 1',
    '    wpid, status = os.waitpid(pid, os.WNOHANG)',
    '    if wpid != 0:',
    '        code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1',
    '        while True:',
    '            ready, _, _ = select.select([fd], [], [], 0.1)',
    '            if not ready:',
    '                break',
    '            try:',
    '                chunk = os.read(fd, 4096)',
    '            except OSError:',
    '                break',
    '            if not chunk:',
    '                break',
    '            out += chunk',
    '        break',
    'else:',
    '    os.kill(pid, 15)',
    'sys.stdout.buffer.write(out)',
    'sys.exit(code)',
  ].join('\n');
  return spawnSync('python3', ['-c', py], {
    input,
    encoding: 'utf8',
    env: {
      ...env,
      PTY_NODE: process.execPath,
      PTY_ARGS: JSON.stringify(args),
    },
  });
}

function fallbackShape(session) {
  return {
    profile: session.profile,
    tool: session.tool,
    env: session.env,
    units: session.units,
    dismissedByRole: session.dismissedByRole,
  };
}

test('A-49 pre_tool refuses a Write under harness/state', () => {
  const tools = ['Write', 'Edit', 'StrReplace', 'MultiEdit', 'Delete'];
  for (const tool_name of tools) {
    const result = hook({
      tool_name,
      tool_input: { path: 'harness/state/session.json', contents: '{}' },
    });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr + result.stdout, /harness\/state/, tool_name);
  }
});

test('A-50 shell writes under harness/state and --allow-check-edit are refused', () => {
  const commands = [
    'echo x > harness/state/session.json',
    'cat a | tee harness/state/session.json',
    'cp /tmp/s.json harness/state/session.json',
    'mv /tmp/s.json harness/state/session.json',
    'rm harness/state/session.json',
    'truncate -s 0 harness/state/session.json',
    "sed -i 's/a/b/' harness/state/session.json",
    `node -e "require('fs').writeFileSync('harness/state/session.json','{}')"`,
    `python -c "open('harness/state/session.json','w').write('x')"`,
    './verify.sh --allow-check-edit',
  ];
  for (const command of commands) {
    const result = hook({ moment: 'beforeShellExecution', command });
    assert.equal(result.status, 2, `${command}\n${result.stderr}\n${result.stdout}`);
    assert.match(result.stderr + result.stdout, /refused:/, command);
  }
});

test('A-51 a hand-edited record is check-weakened', async () => {
  const tmp = tmpDir();
  const answers = ['all', 'cover the config'];
  const recorded = await allowCheckEdit(tmp, {
    isTTY: () => true,
    by: 'Dev',
    env: developerEnv(),
    ask: async () => answers.shift(),
  });
  assert.equal(recorded.exitCode, 0, recorded.text);
  const sessionPath = path.join(tmp, 'harness', 'state', 'session.json');
  const before = spawnSync(process.execPath, [INTEGRITY], {
    cwd: ROOT,
    env: developerEnv({ HARNESS_ROOT: tmp }),
    encoding: 'utf8',
  });
  assert.equal(before.status, 0, before.stderr || before.stdout);

  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  session.explicitCheckEdit.reason = 'tampered by hand';
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n');
  const after = spawnSync(process.execPath, [INTEGRITY], {
    cwd: ROOT,
    env: developerEnv({ HARNESS_ROOT: tmp }),
    encoding: 'utf8',
  });
  assert.equal(after.status, 1, after.stderr || after.stdout);
  assert.match(after.stderr, /check-weakened/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-52 --allow-check-edit refuses each agent environment marker', () => {
  assert.ok(AGENT_ENV_MARKERS.includes('CLAUDECODE'));
  assert.ok(AGENT_ENV_MARKERS.includes('CLAUDE_CODE_CHILD_SESSION'));
  assert.ok(AGENT_ENV_MARKERS.includes('CURSOR_AGENT'));
  for (const marker of AGENT_ENV_MARKERS) {
    const tmp = tmpDir();
    const spawned = spawnSync(process.execPath, [CLI, '--allow-check-edit'], {
      cwd: ROOT,
      env: developerEnv({ HARNESS_ROOT: tmp, [marker]: '1' }),
      encoding: 'utf8',
    });
    assert.equal(spawned.status, 2, marker + (spawned.stderr || spawned.stdout));
    assert.ok((spawned.stdout + spawned.stderr).includes(marker), spawned.stdout + spawned.stderr);
    assert.equal(fs.existsSync(path.join(tmp, 'harness', 'state', 'session.json')), false);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function commitAll(tmp) {
  spawnSync('git', ['init'], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'harness/state/\nharness/retro/\n');
  spawnSync('git', ['add', '-A'], { cwd: tmp });
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: tmp },
  );
  assert.equal(result.status, 0, result.stderr?.toString() || 'commit failed');
}

test('A-53 --loop still writes session, report, and retro', () => {
  const tmp = tmpDir();
  fs.writeFileSync(
    path.join(tmp, 'harness.local.yaml'),
    [
      'tool: cursor',
      'profile: default',
      'confirmProfile: false',
      'roles:',
      '  reviewer: { enabled: true }',
      '  planner: { enabled: true }',
      '  security: { enabled: false }',
      '  product: { enabled: false }',
      '  qa: { enabled: false }',
      '  infra: { enabled: false }',
      '  test-writer: { enabled: false }',
      '  acceptance-checker: { enabled: false }',
      '  integrity-checker: { enabled: false }',
      'review:',
      '  maxCycles: 1',
      '  cadence:',
      '    ship: [reviewer]',
      '    unit: [reviewer]',
      '    turn: [reviewer]',
      '    wave: [reviewer]',
      'loop:',
      '  prd: specs/demo/PRD.md',
      '  maxTurns: 4',
      '  maxSeconds: 30',
      '  maxCostUsd: 5',
      '  gate: never',
      '  stopOnIdenticalFailures: 2',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(tmp, 'harness'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'harness', 'models.yaml'),
    [
      'profiles:',
      '  default:',
      '    reviewer: deep',
      '    planner: deep',
      'tiers:',
      '  deep:',
      '    provider: anthropic',
      '    id: fake-model',
      'providers:',
      '  anthropic:',
      '    type: anthropic',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(tmp, 'specs', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'specs', 'demo', 'PRD.md'), '# demo\n');
  fs.writeFileSync(
    path.join(tmp, 'specs', 'demo', 'acceptance.json'),
    JSON.stringify({
      entries: [{ id: 'A-01', passes: true, test: 'notes/note.test.mjs' }],
    }) + '\n',
  );
  fs.mkdirSync(path.join(tmp, 'harness', 'sensors', 'checks'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'harness', 'sensors', 'checks', 'ok.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  fs.writeFileSync(
    path.join(tmp, 'harness', 'sensors', 'sensors.yaml'),
    [
      'sensors:',
      '  - name: ok',
      '    tier: turn',
      '    where: [local, ci]',
      '    blocking: true',
      '    enabled: true',
      '    missing: skip',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'harness', 'state', 'plan.json'),
    JSON.stringify({
      units: [
        {
          id: 'U1',
          title: 'note',
          touches: ['specs/demo/**'],
          acceptance: ['A-01'],
          estimatedTurns: 1,
        },
      ],
      waves: [['U1']],
    }) + '\n',
  );
  commitAll(tmp);
  const spawned = spawnSync(process.execPath, [CLI, '--loop'], {
    cwd: ROOT,
    env: developerEnv({
      HARNESS_ROOT: tmp,
      HARNESS_FAKE_PROVIDER: '1',
      HARNESS_ENV: 'local',
    }),
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  assert.equal(fs.existsSync(path.join(tmp, 'harness', 'state', 'session.json')), true);
  const report = JSON.parse(
    fs.readFileSync(path.join(tmp, 'harness', 'state', 'report.json'), 'utf8'),
  );
  assert.equal(report.status === 'pass' || report.status === 'no-changes', true);
  const retroDir = path.join(tmp, 'harness', 'retro');
  const sessions = fs.readdirSync(retroDir);
  const retro = fs.readFileSync(path.join(retroDir, sessions[0], 'wave-1.md'), 'utf8');
  assert.match(retro, /## Deterministic/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-54 --allow-check-edit stores tool and profile from the config', () => {
  const tmp = configRoot();
  const env = developerEnv({ HARNESS_ROOT: tmp, HARNESS_ENV: 'ci' });
  const spawned = runPty([CLI, '--allow-check-edit'], env, 'all\ncover the config\n');
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const session = JSON.parse(
    fs.readFileSync(path.join(tmp, 'harness', 'state', 'session.json'), 'utf8'),
  );
  assert.equal(session.tool, 'claude');
  assert.equal(session.profile, 'default');
  assert.equal(session.env, 'ci');
  assert.equal(session.env, resolveHarnessEnv(env));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('A-55 --allow-check-edit and --backlog write the same fallback session', () => {
  const env = developerEnv({ HARNESS_ENV: 'ci' });
  const allowRoot = configRoot();
  const backlogRoot = configRoot();
  fs.mkdirSync(path.join(backlogRoot, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(backlogRoot, 'harness', 'state', 'backlog.json'),
    JSON.stringify({
      items: [
        {
          severity: 'P2',
          role: 'reviewer',
          file: 'a.js',
          line: 1,
          message: 'naming is off',
          category: 'style',
        },
      ],
      categoryHits: {},
    }) + '\n',
  );
  const recorded = runPty(
    [CLI, '--allow-check-edit'],
    { ...env, HARNESS_ROOT: allowRoot },
    'all\ncover the config\n',
  );
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  const triaged = runPty([CLI, '--backlog'], { ...env, HARNESS_ROOT: backlogRoot }, 'keep\n');
  assert.equal(triaged.status, 0, triaged.stdout + triaged.stderr);
  const allowSession = JSON.parse(
    fs.readFileSync(path.join(allowRoot, 'harness', 'state', 'session.json'), 'utf8'),
  );
  const backlogSession = JSON.parse(
    fs.readFileSync(path.join(backlogRoot, 'harness', 'state', 'session.json'), 'utf8'),
  );
  const expected = newAdhocSession(allowRoot, env);
  assert.deepEqual(fallbackShape(allowSession), fallbackShape(backlogSession));
  assert.deepEqual(fallbackShape(allowSession), fallbackShape(expected));
  assert.equal(allowSession.tool, 'claude');
  assert.equal(allowSession.profile, 'default');
  assert.ok(String(allowSession.id).startsWith('adhoc-'));
  assert.ok(String(backlogSession.id).startsWith('adhoc-'));
  fs.rmSync(allowRoot, { recursive: true, force: true });
  fs.rmSync(backlogRoot, { recursive: true, force: true });
});
