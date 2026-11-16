import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(ROOT, 'harness', 'lib', 'cli.mjs');
const NAMES = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'KUBECONFIG',
  'DATABASE_URL',
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-session-'));
  fs.writeFileSync(path.join(root, 'harness.yaml'), 'project: {}\n');
  fs.writeFileSync(path.join(root, 'harness.local.yaml'), 'tool: cursor\n');
  fs.mkdirSync(path.join(root, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'harness', 'state', 'report.json'),
    JSON.stringify({ status: 'pass', tier: 'turn' }) + '\n',
  );
  return root;
}

function ghBin(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gh-'));
  const file = path.join(dir, 'gh');
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
  return dir;
}

/** @param {Record<string, string | undefined>} [extra] */
function baseEnv(root, extra = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    HARNESS_ROOT: root,
    HARNESS_HOOK_MOMENT: 'sessionStart',
  };
  for (const name of NAMES) delete env[name];
  const bin = extra.PATH ? null : ghBin('#!/bin/sh\nexit 1\n');
  if (bin) env.PATH = `${bin}${path.delimiter}${env.PATH || ''}`;
  return { ...env, ...extra };
}

function hook(root, env) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cwd-'));
  return spawnSync(process.execPath, [CLI, '--hook'], {
    cwd,
    input: '{}\n',
    env,
    encoding: 'utf8',
  });
}

function report(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'harness', 'state', 'report.json'), 'utf8'));
}

test('A-110 session start names GH_TOKEN and does not print the value', () => {
  const root = fixture();
  const secret = 'super-secret-value-not-a-name';
  const ran = hook(root, baseEnv(root, { GH_TOKEN: secret }));
  const output = `${ran.stdout}\n${ran.stderr}`;
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(output, /GH_TOKEN/);
  assert.equal(output.includes(secret), false);
  const saved = report(root);
  assert.equal(saved.status, 'pass');
  assert.ok(saved.credentials.visible.includes('GH_TOKEN'));
  assert.equal(JSON.stringify(saved).includes(secret), false);
});

test('A-111 a fake gh login is named', () => {
  const root = fixture();
  const bin = ghBin(
    '#!/bin/sh\nif [ "$1" = auth ] && [ "$2" = status ]; then echo "Logged in to github.com account octocat"; exit 0; fi\nexit 1\n',
  );
  const ran = hook(root, baseEnv(root, { PATH: `${bin}${path.delimiter}${process.env.PATH}` }));
  const output = `${ran.stdout}\n${ran.stderr}`;
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(output, /gh login octocat/);
  assert.match(JSON.stringify(report(root).credentials), /octocat/);
});

test('A-112 no markers and no .env says nothing known is visible', () => {
  const root = fixture();
  const ran = hook(root, baseEnv(root));
  const output = `${ran.stdout}\n${ran.stderr}`;
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(output, /no known credentials visible/);
  assert.match(output, /keychains/);
  assert.match(output, /SSO caches/);
  assert.equal(report(root).credentials.visible.length, 0);
});

test('A-113 the credentials warning does not change the session start exit code', () => {
  const quiet = hook(fixture(), baseEnv(fixture()));
  const named = hook(fixture(), baseEnv(fixture(), { GH_TOKEN: 'another-secret-value' }));
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(named.status, 0, named.stderr);
  assert.equal(`${named.stdout}\n${named.stderr}`.includes('another-secret-value'), false);
});
