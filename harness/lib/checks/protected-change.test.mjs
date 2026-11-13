import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    if (state.failReviews && url.pathname.endsWith('/reviews')) {
      status = 500;
      body = { message: 'nope' };
    } else if (url.pathname.endsWith('/reviews')) body = state.reviews;
    else if (url.pathname.endsWith('/timeline')) body = state.timeline;
    else if (url.pathname.endsWith('/labels')) body = state.labels.map((name) => ({ name }));
    else if (url.pathname.endsWith('/pulls')) body = state.pulls;
    else {
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
    assert.equal(ran.status, 1, out);
    assert.match(out, /harness\.yaml/);
    assert.match(out, /matched harness\.yaml/);
    assert.match(out, /owners: ada/);

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
    assert.equal(report.status, 'fail');
    const status = spawnSync(
      process.execPath,
      [path.join(ROOT, 'harness', 'lib', 'cli.mjs'), '--status'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    assert.match(status.stdout, /CI-only:.*protected-change/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-65 an owner review on the head SHA passes, and the author review does not', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @ada\n');
  const eventPath = writeEvent(root, pullEvent(base, head, { author: 'dev' }));
  const state = { reviews: [], timeline: [], labels: [], pulls: [], failReviews: false };
  const mock = await startMock(state);
  try {
    state.reviews = [
      {
        user: { login: 'dev' },
        state: 'APPROVED',
        commit_id: head,
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ];
    const authorOnly = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(authorOnly.status, 1, authorOnly.stdout + authorOnly.stderr);
    state.reviews.push({
      user: { login: 'ada' },
      state: 'APPROVED',
      commit_id: head,
      submitted_at: '2026-01-02T00:00:00Z',
    });
    const owned = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request_review',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    const out = owned.stdout + owned.stderr;
    assert.equal(owned.status, 0, out);
    assert.match(out, /harness\.yaml approver ada route review/);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-66 an approval on an older commit does not count', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @ada\n');
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
    assert.equal(current.status, 0, current.stdout + current.stderr);
  } finally {
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('A-67 the solo label passes, a synchronize removes it, and a backdated committer date does not matter', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness', {
    GIT_AUTHOR_DATE: '2099-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z',
  });
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @solo\n');
  const eventPath = writeEvent(
    root,
    pullEvent(base, head, { author: 'solo', action: 'synchronize' }),
  );
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
      created_at: '2024-01-01T00:00:00Z',
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

test('A-68 a label added by someone outside CODEOWNERS does not count', async () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project:\n  name: demo\n');
  const head = commitAll(root, 'edit harness');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @solo\n');
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
    assert.match(out, /harness\.yaml/);
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
    state.reviews = [
      {
        user: { login: 'ada' },
        state: 'APPROVED',
        commit_id: head,
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ];
    const allowed = await runSensor(root, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: mock.url,
    });
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
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
  assert.equal(missing.status, 2, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /GITHUB_TOKEN/);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), 'harness.yaml @ada\n');
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
      GITHUB_EVENT_PATH: eventPath,
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
