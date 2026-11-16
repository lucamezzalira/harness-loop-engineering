import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(ROOT, 'harness', 'sensors', 'checks', 'platform-rules.sh');

const MISSING = [
  'missing pull_request',
  'missing pull_request required_approving_review_count',
  'missing pull_request require_code_owner_review',
  'missing pull_request dismiss_stale_reviews_on_push',
  'missing pull_request require_last_push_approval',
  'missing pull_request required_reviewers minimum_approvals',
  'missing pull_request required_reviewers file_patterns harness.yaml',
  'missing pull_request required_reviewers file_patterns notes/schema.sql',
  'missing required_status_checks verify',
  'missing required_status_checks protected-change',
];

function yaml(mode) {
  return `platform:
  mode: ${mode}
  pullRequest:
    requiredApprovingReviewCount: 1
    requireCodeOwnerReview: true
    dismissStaleReviewsOnPush: true
    requireLastPushApproval: true
  requiredStatusChecks:
    - verify
    - protected-change
  requiredReviewers:
    minimumApprovals: 2
protect:
  checkPaths:
    - harness.yaml
review:
  humanRequired:
    paths:
      - notes/schema.sql
`;
}

function fixture(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-rules-'));
  fs.writeFileSync(path.join(root, 'harness.yaml'), yaml(mode));
  fs.writeFileSync(
    path.join(root, 'event.json'),
    JSON.stringify({ repository: { default_branch: 'main' } }),
  );
  return root;
}

function listen(handler) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const result = handler(url);
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      const { port } = address;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** @param {Record<string, string | undefined>} [extra] */
function sensorEnv(root, api, extra = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    HARNESS_ROOT: root,
    HARNESS_ENV: 'ci',
    GITHUB_REPOSITORY: 'acme/demo',
    GITHUB_EVENT_PATH: path.join(root, 'event.json'),
    GITHUB_API_URL: api,
    ...extra,
  };
  if (!Object.prototype.hasOwnProperty.call(extra, 'GITHUB_TOKEN')) env.GITHUB_TOKEN = 'test-token';
  if (
    extra.GITHUB_TOKEN === undefined &&
    Object.prototype.hasOwnProperty.call(extra, 'GITHUB_TOKEN')
  ) {
    delete env.GITHUB_TOKEN;
  }
  return env;
}

function run(root, api, extra) {
  return new Promise((resolve) => {
    const child = spawn('bash', [SCRIPT], {
      cwd: root,
      env: sensorEnv(root, api, extra),
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

function fullRules(stale = true) {
  return [
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        require_code_owner_review: true,
        dismiss_stale_reviews_on_push: stale,
        require_last_push_approval: true,
        required_reviewers: [
          {
            file_patterns: ['harness.yaml', 'notes/schema.sql'],
            minimum_approvals: 2,
            reviewer: { id: 1, type: 'Team' },
          },
        ],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'verify' }, { context: 'protected-change' }],
      },
    },
  ];
}

test('A-105 no rules on the default branch names every expected rule', async () => {
  const server = await listen(() => ({ status: 200, body: [] }));
  try {
    const warnRoot = fixture('warn');
    const warn = await run(warnRoot, server.url);
    assert.equal(warn.status, 0, warn.stderr);
    for (const line of MISSING) assert.ok(warn.stdout.includes(line), line);
    const blockRoot = fixture('block');
    const block = await run(blockRoot, server.url);
    assert.equal(block.status, 1, block.stderr);
    for (const line of MISSING) assert.ok(block.stdout.includes(line), line);
  } finally {
    await server.close();
  }
});

test('A-106 dismiss_stale_reviews_on_push false is named', async () => {
  const server = await listen(() => ({ status: 200, body: fullRules(false) }));
  try {
    const ran = await run(fixture('warn'), server.url);
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /pull_request dismiss_stale_reviews_on_push is false/);
  } finally {
    await server.close();
  }
});

test('A-107 the bypass line is always present and never called safe', async () => {
  const server = await listen(() => ({ status: 200, body: fullRules(true) }));
  try {
    const ran = await run(fixture('warn'), server.url);
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /bypass list not visible to this token, check Settings/);
    assert.doesNotMatch(ran.stdout, /bypass list empty|bypass.*safe/i);
  } finally {
    await server.close();
  }
});

test('A-108 an unmapped rule type is unknown and not a pass', async () => {
  const server = await listen(() => ({
    status: 200,
    body: [{ type: 'not_a_documented_rule' }],
  }));
  try {
    const ran = await run(fixture('warn'), server.url);
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /unknown not_a_documented_rule/);
    assert.doesNotMatch(ran.stdout, /not_a_documented_rule pass/);
  } finally {
    await server.close();
  }
});

test('A-109 a missing token or an API error exits 2', async () => {
  const down = await listen(() => ({ status: 500, body: { message: 'nope' } }));
  try {
    const missing = await run(fixture('warn'), down.url, { GITHUB_TOKEN: undefined });
    assert.equal(missing.status, 2, missing.stderr);
    const errored = await run(fixture('warn'), down.url);
    assert.equal(errored.status, 2, errored.stderr);
  } finally {
    await down.close();
  }
});
