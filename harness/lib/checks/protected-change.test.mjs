import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SENSOR = path.join(ROOT, 'harness', 'sensors', 'checks', 'protected-change.sh');
const CLEAR = path.join(ROOT, 'harness', 'lib', 'checks', 'clear-protected-label.mjs');
const MODULE = path.join(ROOT, 'harness', 'lib', 'checks', 'protected-change.mjs');
const LABEL = 'protected-change-approved';

function git(cwd, args, env = {}) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, ...env } },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return (result.stdout || '').trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pr-'));
  git(root, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function commitAll(root, message, env = {}) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message], env);
  return git(root, ['rev-parse', 'HEAD']);
}

function writeEvent(root, event) {
  const file = path.join(root, 'event.json');
  fs.writeFileSync(file, JSON.stringify(event));
  return file;
}

function pullEvent(base, head, extra = {}) {
  return {
    action: extra.action || 'opened',
    repository: { full_name: 'acme/demo', default_branch: 'main' },
    pull_request: {
      number: 7,
      user: { login: extra.author || 'dev' },
      base: { sha: base },
      head: { sha: head },
      labels: extra.labels || [],
      updated_at: extra.updated_at,
    },
  };
}

function startMock(state) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push({ method: req.method, path: url.pathname });
    if (req.method === 'DELETE' && url.pathname.endsWith(`/labels/${LABEL}`)) {
      state.labels = state.labels.filter((name) => name !== LABEL);
      res.writeHead(204);
      res.end();
      return;
    }
    /** @type {unknown} */
    let body = [];
    let status = 200;
    if (
      state.failReviews &&
      (url.pathname.endsWith('/reviews') ||
        url.pathname.endsWith('/labels') ||
        url.pathname.endsWith('/timeline'))
    ) {
      status = 500;
      body = { message: 'nope' };
    } else if (url.pathname.endsWith('/reviews')) body = state.reviews;
    else if (url.pathname.endsWith('/timeline')) body = state.timeline;
    else if (url.pathname.endsWith('/labels')) body = state.labels.map((name) => ({ name }));
    else if (url.pathname.endsWith('/pulls')) body = state.pulls;
    else if (url.pathname.includes('/rules/branches/')) {
      if (state.rulesStatus) {
        status = state.rulesStatus;
        body = { message: 'nope' };
      } else if (Array.isArray(state.rules)) body = state.rules;
      else {
        body = [
          {
            type: 'pull_request',
            ruleset_source: 'acme/demo',
            ruleset_id: 42,
            parameters: { require_code_owner_review: true },
          },
        ];
      }
    } else {
      status = 404;
      body = { message: 'missing' };
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function spawnOut(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function sensorEnv(root, extra = {}) {
  return {
    ...process.env,
    HARNESS_ROOT: root,
    HARNESS_ENV: 'ci',
    GITHUB_REPOSITORY: 'acme/demo',
    GITHUB_TOKEN: 'test-token',
    ...extra,
  };
}

function runSensor(root, env) {
  return spawnOut('bash', [SENSOR], sensorEnv(root, env));
}

test('A-64 a protected change with no review fails and names the file, rule, and owner', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'dev' }));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = `${ran.stdout}\n${ran.stderr}`;
    assert.equal(ran.status, 0, out);
    assert.match(out, /harness\.yaml/);
    assert.match(out, /matched harness\.yaml/);
    assert.match(out, /ruleset decides/);

    fs.mkdirSync(path.join(root, 'harness', 'sensors', 'checks'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'harness', 'sensors', 'sensors.yaml'),
      [
        'sensors:',
        '  - name: protected-change',
        '    tier: commit',
        '    where: [ci]',
        '    blocking: true',
        '    enabled: true',
        '    missing: n/a',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(root, 'harness', 'sensors', 'checks', 'protected-change.sh'),
      `#!/usr/bin/env bash\nset -euo pipefail\nexec node ${JSON.stringify(MODULE)}\n`,
    );
    const helper = path.join(root, 'report-once.mjs');
    fs.writeFileSync(
      helper,
      [
        `import { runChecks } from ${JSON.stringify(path.join(ROOT, 'harness/lib/checks/runner.mjs'))};`,
        `import { loadConfig } from ${JSON.stringify(path.join(ROOT, 'harness/lib/config.mjs'))};`,
        'const root = process.argv[2];',
        "const report = await runChecks(root, loadConfig(root), { tier: 'commit' });",
        'process.stdout.write(JSON.stringify(report.protectedChange ?? null));',
        '',
      ].join('\n'),
    );
    const reported = await spawnOut(
      process.execPath,
      [helper, root],
      sensorEnv(root, {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_API_URL: mock.url,
      }),
    );
    assert.equal(reported.status, 0, reported.stdout + reported.stderr);
    const report = JSON.parse(reported.stdout);
    assert.equal(report.files[0].file, 'harness.yaml');
    assert.equal(report.files[0].route, 'ruleset');
    assert.equal(report.status, 'pass');
    const statusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-status-ci-'));
    fs.writeFileSync(path.join(statusRoot, 'harness.local.yaml'), 'tool: cursor\n');
    fs.mkdirSync(path.join(statusRoot, 'harness', 'sensors'), { recursive: true });
    fs.writeFileSync(
      path.join(statusRoot, 'harness', 'sensors', 'sensors.yaml'),
      [
        'sensors:',
        '  - name: protected-change',
        '    tier: commit',
        '    where: [ci]',
        '    blocking: true',
        '    enabled: true',
        '    missing: n/a',
        '',
      ].join('\n'),
    );
    const status = spawnSync(
      process.execPath,
      [path.join(ROOT, 'harness', 'lib', 'cli.mjs'), '--status'],
      {
        cwd: statusRoot,
        encoding: 'utf8',
        env: { ...process.env, HARNESS_ROOT: statusRoot },
      },
    );
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /CI-only:.*protected-change/);
    fs.rmSync(statusRoot, { recursive: true, force: true });
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-65 a review does not decide a pattern, and a protected path reports the ruleset', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'dev' }));
  const state = {
    reviews: [
      {
        user: { login: 'dev' },
        state: 'APPROVED',
        commit_id: head,
        submitted_at: '2026-01-01T00:00:00Z',
      },
      {
        user: { login: 'ada' },
        state: 'APPROVED',
        commit_id: head,
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  };
  const mock = await startMock(state);
  try {
    const reviewed = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = reviewed.stdout + reviewed.stderr;
    assert.equal(reviewed.status, 1, out);
    assert.match(out, /DROP\\s\+TABLE/);
    assert.doesNotMatch(out, /route review/);
    fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
    const pathHead = commitAll(root, 'edit harness');
    const pathEvent = writeEvent(root, pullEvent(head, pathHead, { author: 'dev' }));
    const ruleset = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: pathEvent,
      GITHUB_API_URL: mock.url,
    });
    const rulesetOut = ruleset.stdout + ruleset.stderr;
    assert.equal(ruleset.status, 0, rulesetOut);
    assert.match(rulesetOut, /harness\.yaml matched harness\.yaml ruleset decides/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-66 an approval on an older commit does not count', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head));
  const state = {
    reviews: [
      {
        user: { login: 'ada' },
        state: 'APPROVED',
        commit_id: base,
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  };
  const mock = await startMock(state);
  try {
    const stale = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.doesNotMatch(stale.stdout, /route review/);
    state.reviews = [
      {
        user: { login: 'ada' },
        state: 'APPROVED',
        commit_id: head,
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ];
    const current = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = current.stdout + current.stderr;
    assert.equal(current.status, 1, out);
    assert.doesNotMatch(out, /route review/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-67 the solo label passes, a synchronize removes it, and a backdated committer date does not matter', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop', {
    GIT_AUTHOR_DATE: '2099-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z',
  });
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @solo\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'solo', action: 'opened' }));
  const state = {
    reviews: [],
    timeline: [
      {
        event: 'labeled',
        actor: { login: 'solo' },
        label: { name: LABEL },
        created_at: '2020-01-01T00:00:00Z',
      },
    ],
    labels: [LABEL],
    pulls: [],
    failReviews: false,
  };
  const mock = await startMock(state);
  const env = {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_API_URL: mock.url,
  };
  try {
    const passed = await runSensor(root, env);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.match(passed.stdout, /approver solo route label/);
    fs.writeFileSync(
      eventPath,
      JSON.stringify(
        pullEvent(base, head, {
          author: 'solo',
          action: 'synchronize',
          updated_at: '2024-06-01T00:00:00Z',
        }),
      ),
    );
    const cleared = await spawnOut(process.execPath, [CLEAR], sensorEnv(root, env));
    assert.equal(cleared.status, 0, cleared.stdout + cleared.stderr);
    assert.ok(
      mock.calls.some((call) => call.method === 'DELETE' && call.path.includes('/labels/')),
    );
    const after = await runSensor(root, env);
    assert.equal(after.status, 1, after.stdout + after.stderr);
    state.labels = [LABEL];
    state.timeline.push({
      event: 'labeled',
      actor: { login: 'solo' },
      label: { name: LABEL },
      created_at: '2024-07-01T00:00:00Z',
    });
    const again = await runSensor(root, env);
    assert.equal(again.status, 0, again.stdout + again.stderr);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-67 the label job loads from a tree that has no node_modules', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-clear-')));
  fs.copyFileSync(
    path.join(ROOT, 'harness', 'lib', 'checks', 'github-api.mjs'),
    path.join(dir, 'github-api.mjs'),
  );
  fs.copyFileSync(CLEAR, path.join(dir, 'clear-protected-label.mjs'));
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ action: 'opened' }));
  const ran = spawnSync(process.execPath, [path.join(dir, 'clear-protected-label.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
    },
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  assert.match(ran.stdout, /clear-protected-label skipped/);
  assert.doesNotMatch(`${ran.stderr}`, /yaml|Cannot find package/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A-87 a label older than the synchronize event does not count', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @solo\n');
  const event = pullEvent(base, head, {
    author: 'solo',
    action: 'synchronize',
    updated_at: '2024-06-01T00:00:00Z',
  });
  const eventPath = writeEvent(root, event);
  const state = {
    reviews: [],
    timeline: [
      {
        event: 'labeled',
        actor: { login: 'solo' },
        label: { name: LABEL },
        created_at: '2024-01-01T00:00:00Z',
      },
    ],
    labels: [LABEL],
    pulls: [],
    failReviews: false,
  };
  const mock = await startMock(state);
  const env = {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_API_URL: mock.url,
  };
  try {
    const stale = await runSensor(root, env);
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    state.timeline.push({
      event: 'labeled',
      actor: { login: 'solo' },
      label: { name: LABEL },
      created_at: '2024-07-01T00:00:00Z',
    });
    const fresh = await runSensor(root, env);
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
    assert.match(fresh.stdout, /approver solo route label/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-68 a label added by someone outside CODEOWNERS does not count', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @solo\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'solo' }));
  const mock = await startMock({
    reviews: [],
    timeline: [
      {
        event: 'labeled',
        actor: { login: 'intruder' },
        label: { name: LABEL },
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    labels: [LABEL],
    pulls: [],
    failReviews: false,
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = ran.stdout + ran.stderr;
    assert.equal(ran.status, 1, out);
    assert.match(out, /notes\/schema\.sql/);
    assert.doesNotMatch(out, /approver intruder/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-69 a human-required line needs approval even when the path is not protected', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'dev' }));
  const state = { reviews: [], timeline: [], labels: [], pulls: [], failReviews: false };
  const mock = await startMock(state);
  try {
    const blocked = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const blockedOut = blocked.stdout + blocked.stderr;
    assert.equal(blocked.status, 1, blockedOut);
    assert.match(blockedOut, /notes\/schema\.sql/);
    assert.match(blockedOut, /DROP\\s\+TABLE/);
    assert.match(blockedOut, /owners: ada/);
    state.labels = [LABEL];
    state.timeline = [
      {
        event: 'labeled',
        actor: { login: 'ada' },
        label: { name: LABEL },
        created_at: '2026-01-02T00:00:00Z',
      },
    ];
    const allowed = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    assert.match(allowed.stdout, /approver ada route label/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-70 a pull request with no protected changes calls neither reviews nor the timeline', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'README.md'), 'changed\n');
  const head = commitAll(root, 'readme');
  const eventPath = writeEvent(root, pullEvent(base, head));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    const watched = mock.calls.filter(
      (call) => call.path.endsWith('/reviews') || call.path.endsWith('/timeline'),
    );
    assert.equal(watched.length, 0);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-71 a default-branch push with no pull request fails, and a feature push is skipped', async () => {
  const root = initRepo();
  const before = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const after = commitAll(root, 'edit harness');
  const pushPath = writeEvent(root, {
    ref: 'refs/heads/main',
    before,
    after,
    repository: { full_name: 'acme/demo', default_branch: 'main' },
  });
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  });
  try {
    const pushed = await runSensor(root, {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: pushPath,
      GITHUB_API_URL: mock.url,
      GITHUB_SHA: after,
    });
    const pushedOut = pushed.stdout + pushed.stderr;
    assert.equal(pushed.status, 1, pushedOut);
    assert.match(pushedOut, /harness\.yaml/);
    assert.match(pushedOut, /no pull request/);
    const featurePath = writeEvent(root, {
      ref: 'refs/heads/feature',
      before,
      after,
      repository: { full_name: 'acme/demo', default_branch: 'main' },
    });
    const skipped = await runSensor(root, {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: featurePath,
      GITHUB_TOKEN: '',
      GITHUB_API_URL: mock.url,
    });
    assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
    assert.match(skipped.stdout, /skipped \(no pull request\)/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-72 a missing token or a GitHub API error exits 2', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness');
  const eventPath = writeEvent(root, pullEvent(base, head));
  const missing = await runSensor(root, {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_TOKEN: '',
  });
  const missingOut = missing.stdout + missing.stderr;
  assert.equal(missing.status, 2, missingOut);
  assert.notEqual(missing.status, 0);
  assert.match(missingOut, /GITHUB_TOKEN is missing/);
  assert.match(missingOut, /The check failed closed and the label route applies/);
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const patterned = commitAll(root, 'drop');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const patternedEvent = writeEvent(root, pullEvent(base, patterned));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: true,
  });
  try {
    const broken = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: patternedEvent,
      GITHUB_API_URL: mock.url,
    });
    const out = broken.stdout + broken.stderr;
    assert.equal(broken.status, 2, out);
    assert.match(out, /GitHub API 500/);
    assert.notEqual(broken.status, 0);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'protected-change.yml');
const SECURITY_DOC =
  'https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target';

function localImports(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  if (/from ['"]yaml['"]/.test(text)) seen.add('yaml');
  for (const match of text.matchAll(/from '(\.[^']+)'/g)) {
    let next = path.resolve(path.dirname(file), match[1]);
    if (!next.endsWith('.mjs')) next += '.mjs';
    localImports(next, seen);
  }
  return seen;
}

function jobSteps(job) {
  return Array.isArray(job?.steps) ? job.steps : [];
}

test('A-101 and A-118 the base-branch workflow parses and does not run the pull request', () => {
  const raw = fs.readFileSync(WORKFLOW, 'utf8');
  const doc = parseYaml(raw);
  const trigger = doc.on.pull_request_target;
  assert.ok(trigger, 'trigger is pull_request_target');
  for (const type of ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']) {
    assert.ok(trigger.types.includes(type), type);
  }
  assert.equal(doc.on.pull_request, undefined);
  assert.equal(doc.on.pull_request_review, undefined);
  assert.match(raw, /securely-using-pull_request_target/);
  assert.match(raw, /BASE_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/);
  const guidance = fs.readFileSync(
    path.join(ROOT, 'harness', 'sensors', 'guidance', 'protected-change.md'),
    'utf8',
  );
  assert.match(guidance, /securely-using-pull_request_target/);
  assert.match(guidance, /reads the pull request as data|read as data/);
  const sensorJob = doc.jobs['protected-change'];
  assert.equal(sensorJob.permissions.contents, 'read');
  assert.equal(sensorJob.permissions['pull-requests'], 'read');
  assert.equal(sensorJob.permissions.issues, 'read');
  assert.notEqual(sensorJob.permissions.issues, 'write');
  assert.equal(doc.jobs['clear-protected-label'].permissions.issues, 'write');
  for (const job of Object.values(doc.jobs)) {
    for (const step of jobSteps(job)) {
      const ref = String(step.with?.ref || '');
      assert.doesNotMatch(ref, /head\.sha|head\.ref|\/head|\/merge/);
      assert.doesNotMatch(ref, /github\.event\.pull_request/);
      if (String(step.uses || '').startsWith('actions/checkout@')) {
        assert.match(ref, /env\.BASE_SHA/);
      }
      const run = String(step.run || '');
      assert.doesNotMatch(run, /\bnpm (?:install|ci)\b/);
      assert.doesNotMatch(run, /\bgit checkout\b/);
      assert.doesNotMatch(run, /node\s+\S*refs\/pull/);
    }
  }
  assert.equal(localImports(MODULE).has('yaml'), false);
  assert.equal(localImports(CLEAR).has('yaml'), false);
  assert.equal(SECURITY_DOC.includes('securely-using-pull_request_target'), true);
});

test('A-104 ci.yml does not run protected-change and status names the base-branch workflow', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(ci, /protected-change/);
  const sensors = fs.readFileSync(path.join(ROOT, 'harness', 'sensors', 'sensors.yaml'), 'utf8');
  assert.match(sensors, /name: protected-change[\s\S]*tier: manual/);
  const local = path.join(ROOT, 'harness.local.yaml');
  const created = !fs.existsSync(local);
  if (created) fs.writeFileSync(local, 'tool: cursor\nprofile: default\n');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-status-'));
  try {
    const status = spawnSync(
      process.execPath,
      [path.join(ROOT, 'harness', 'lib', 'cli.mjs'), '--status'],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, HARNESS_ROOT: ROOT },
      },
    );
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /base-branch workflow: protected-change/);
  } finally {
    if (created) fs.rmSync(local, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('A-102 a poisoned head still fails on the base copy of the sensor', async () => {
  const root = initRepo();
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    "review:\n  humanRequired:\n    patterns:\n      - 'DROP\\s+TABLE'\n",
  );
  commitAll(root, 'base config');
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-b', 'pr']);
  fs.mkdirSync(path.join(root, 'harness', 'lib', 'checks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness', 'lib', 'checks', 'protected-change.mjs'),
    'process.exit(0)\nDROP TABLE users\n',
  );
  const head = commitAll(root, 'poison');
  git(root, ['checkout', 'main']);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness/lib/checks/** @ada\n');
  const poisoned = git(root, ['show', `${head}:harness/lib/checks/protected-change.mjs`]);
  assert.match(poisoned, /process\.exit\(0\)/);
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /process\.exit\(0\)/);
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'dev' }));
  fs.mkdirSync(path.join(root, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness', 'state', 'protected-change.json'),
    JSON.stringify({ status: 'pass', files: [] }) + '\n',
  );
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = `${ran.stdout}\n${ran.stderr}`;
    assert.equal(ran.status, 1, out);
    assert.match(out, /DROP\\s\+TABLE/);
    assert.doesNotMatch(out, /protected-change ok/);
    const written = JSON.parse(
      fs.readFileSync(path.join(root, 'harness', 'state', 'protected-change.json'), 'utf8'),
    );
    assert.equal(written.status, 'fail');
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-103 the decision uses the base harness.yaml when the head deletes the pattern', async () => {
  const root = initRepo();
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    "review:\n  humanRequired:\n    patterns:\n      - 'DROP\\s+TABLE'\n",
  );
  commitAll(root, 'base config');
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-b', 'pr']);
  fs.writeFileSync(
    path.join(root, 'harness.yaml'),
    "review:\n  humanRequired:\n    patterns:\n      - 'NOT_A_REAL_PATTERN'\n",
  );
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'strip pattern');
  git(root, ['checkout', 'main']);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'dev' }));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    failReviews: false,
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = `${ran.stdout}\n${ran.stderr}`;
    assert.equal(ran.status, 1, out);
    assert.match(out, /DROP\\s\+TABLE/);
    const headYaml = git(root, ['show', `${head}:harness.yaml`]);
    assert.doesNotMatch(headYaml, /DROP\\s\+TABLE/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-119 a pattern outside protected paths needs a current label, and a path reports the ruleset', async () => {
  const root = initRepo();
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  const base = git(root, ['rev-parse', 'HEAD~1']);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const eventPath = writeEvent(
    root,
    pullEvent(base, head, {
      author: 'dev',
      action: 'synchronize',
      updated_at: '2026-06-01T00:00:00Z',
    }),
  );
  const state = {
    reviews: [],
    timeline: [
      {
        event: 'labeled',
        actor: { login: 'ada' },
        label: { name: LABEL },
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    labels: [LABEL],
    pulls: [],
    failReviews: false,
  };
  const mock = await startMock(state);
  try {
    const stale = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const staleOut = `${stale.stdout}\n${stale.stderr}`;
    assert.equal(stale.status, 1, staleOut);
    assert.match(staleOut, /notes\/schema\.sql/);
    assert.match(staleOut, /DROP\\s\+TABLE/);
    state.timeline.push({
      event: 'labeled',
      actor: { login: 'ada' },
      label: { name: LABEL },
      created_at: '2026-07-01T00:00:00Z',
    });
    const fresh = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
    assert.match(fresh.stdout, /approver ada route label/);

    const pathRoot = initRepo();
    const pathBase = git(pathRoot, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(pathRoot, 'harness.yaml'), 'project:\n  name: demo\n');
    const pathHead = commitAll(pathRoot, 'edit harness');
    const pathEvent = writeEvent(pathRoot, pullEvent(pathBase, pathHead, { author: 'dev' }));
    const ruleset = await runSensor(pathRoot, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: pathEvent,
      GITHUB_API_URL: mock.url,
    });
    const rulesetOut = `${ruleset.stdout}\n${ruleset.stderr}`;
    assert.equal(ruleset.status, 0, rulesetOut);
    assert.match(
      rulesetOut,
      /ruleset decides: pull request rule \(require review from code owners\); required reviewer rule/,
    );
    assert.match(rulesetOut, /protected-change ok/);
    fs.rmSync(pathRoot, { recursive: true, force: true });
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function harnessPull() {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @ada\n');
  return { root, base, head };
}

test('A-120 no active ruleset sends a protected path back to the label', async () => {
  const { root, base, head } = harnessPull();
  const eventPath = writeEvent(
    root,
    pullEvent(base, head, {
      action: 'synchronize',
      updated_at: '2026-06-01T00:00:00Z',
    }),
  );
  const state = { reviews: [], timeline: [], labels: [], pulls: [], rules: [] };
  const mock = await startMock(state);
  fs.mkdirSync(path.join(root, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness', 'state', 'protected-change.json'),
    JSON.stringify({ status: 'pass' }) + '\n',
  );
  try {
    const bare = await spawnOut('bash', [SENSOR, '--ruleset-decides'], {
      ...sensorEnv(root),
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const bareOut = `${bare.stdout}\n${bare.stderr}`;
    assert.equal(bare.status, 1, bareOut);
    assert.match(bareOut, /protected-change-approved/);
    const planted = JSON.parse(
      fs.readFileSync(path.join(root, 'harness', 'state', 'protected-change.json'), 'utf8'),
    );
    assert.equal(planted.status, 'fail');

    state.labels.push(LABEL);
    state.timeline.push({
      event: 'labeled',
      actor: { login: 'ada' },
      label: { name: LABEL },
      created_at: '2026-07-01T00:00:00Z',
    });
    const fresh = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
    assert.match(fresh.stdout, /approver ada route label/);

    writeEvent(
      root,
      pullEvent(base, head, {
        action: 'synchronize',
        updated_at: '2026-08-01T00:00:00Z',
      }),
    );
    const stale = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const staleOut = `${stale.stdout}\n${stale.stderr}`;
    assert.equal(stale.status, 1, staleOut);
    assert.match(staleOut, /protected-change-approved/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-121 an active code owner rule names the ruleset source and id', async () => {
  const { root, base, head } = harnessPull();
  const eventPath = writeEvent(root, pullEvent(base, head));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    rules: [
      {
        type: 'pull_request',
        ruleset_source: 'octo-org/octo-repo',
        ruleset_id: 73,
        parameters: { require_code_owner_review: true },
      },
    ],
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = `${ran.stdout}\n${ran.stderr}`;
    assert.equal(ran.status, 0, out);
    assert.match(out, /ruleset_source octo-org\/octo-repo/);
    assert.match(out, /ruleset_id 73/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-122 a rules error does not pass a protected path', async () => {
  const { root, base, head } = harnessPull();
  const eventPath = writeEvent(root, pullEvent(base, head));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    rulesStatus: 500,
  });
  fs.mkdirSync(path.join(root, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness', 'state', 'protected-change.json'),
    JSON.stringify({ status: 'pass' }) + '\n',
  );
  try {
    const broken = await spawnOut('bash', [SENSOR, '--ruleset-decides'], {
      ...sensorEnv(root),
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const brokenOut = `${broken.stdout}\n${broken.stderr}`;
    assert.equal(broken.status, 2, brokenOut);
    assert.notEqual(broken.status, 0);
    assert.match(brokenOut, /GitHub API 500/);
    assert.match(brokenOut, /The check failed closed and the label route applies/);
    const planted = JSON.parse(
      fs.readFileSync(path.join(root, 'harness', 'state', 'protected-change.json'), 'utf8'),
    );
    assert.equal(planted.status, 'fail');
    const missing = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
      GITHUB_TOKEN: '',
    });
    const missingOut = `${missing.stdout}\n${missing.stderr}`;
    assert.equal(missing.status, 2, missingOut);
    assert.notEqual(missing.status, 0);
    assert.match(missingOut, /GITHUB_TOKEN is missing/);
    assert.match(missingOut, /The check failed closed and the label route applies/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-123 both sensors import the one rule-reading module', () => {
  const pc = fs.readFileSync(path.join(ROOT, 'harness/lib/checks/protected-change.mjs'), 'utf8');
  const pr = fs.readFileSync(path.join(ROOT, 'harness/lib/checks/platform-rules.mjs'), 'utf8');
  assert.match(pc, /from '\.\/branch-rules\.mjs'/);
  assert.match(pr, /from '\.\/branch-rules\.mjs'/);
  const definitions = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      if (!name.endsWith('.mjs') || name.endsWith('.test.mjs')) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (text.includes('export const PULL_FIELDS')) definitions.push(path.relative(ROOT, abs));
    }
  }
  walk(path.join(ROOT, 'harness'));
  assert.deepEqual(definitions, ['harness/lib/checks/branch-rules.mjs']);
});

test('A-124 a pattern line still needs the label whatever the rules API returns', async () => {
  const root = initRepo();
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'schema.sql'), 'DROP TABLE users;\n');
  const head = commitAll(root, 'drop');
  const base = git(root, ['rev-parse', 'HEAD~1']);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'notes/schema.sql @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head));
  const deciding = [
    {
      type: 'pull_request',
      ruleset_source: 'acme/demo',
      ruleset_id: 42,
      parameters: { require_code_owner_review: true },
    },
  ];
  const state = { reviews: [], timeline: [], labels: [], pulls: [], rules: deciding };
  const mock = await startMock(state);
  try {
    const withRule = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(withRule.status, 1, withRule.stdout + withRule.stderr);
    assert.match(withRule.stdout, /DROP\\s\+TABLE/);
    state.rules = [];
    const without = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(without.status, 1, without.stdout + without.stderr);
    assert.match(without.stdout, /DROP\\s\+TABLE/);
    state.labels.push(LABEL);
    state.timeline.push({
      event: 'labeled',
      actor: { login: 'ada' },
      label: { name: LABEL },
      created_at: '2026-07-01T00:00:00Z',
    });
    const labelled = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(labelled.status, 0, labelled.stdout + labelled.stderr);
    assert.match(labelled.stdout, /approver ada route label/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-125 a rules response missing type exits 2', async () => {
  const { root, base, head } = harnessPull();
  const eventPath = writeEvent(root, pullEvent(base, head));
  const mock = await startMock({
    reviews: [],
    timeline: [],
    labels: [],
    pulls: [],
    rules: [{ parameters: { require_code_owner_review: true }, ruleset_id: 73 }],
  });
  try {
    const ran = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = `${ran.stdout}\n${ran.stderr}`;
    assert.equal(ran.status, 2, out);
    assert.notEqual(ran.status, 0);
    assert.match(out, /missing type/);
    assert.match(out, /The check failed closed and the label route applies/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
