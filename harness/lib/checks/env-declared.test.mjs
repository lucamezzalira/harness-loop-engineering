import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(ROOT, 'harness', 'sensors', 'checks', 'env-declared.sh');

function runIn(tmp, envExtra = {}) {
  return spawnSync('bash', [SCRIPT], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: tmp, ...envExtra },
  });
}

function seedEnvModule(tmp, keys) {
  const dir = path.join(tmp, 'services', 'orders', 'config');
  fs.mkdirSync(dir, { recursive: true });
  const body = keys
    .map((k) => `  ${k.toLowerCase()}: required('${k}'),`)
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'env.js'),
    `function required(name){return process.env[name]}\nexport const env = {\n${body}\n};\n`,
  );
}

test('env-declared: absent .env.example exits 3', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envdec-'));
  try {
    const r = runIn(tmp);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /\.env\.example/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('env-declared: schema key missing from .env.example fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envdec-'));
  try {
    fs.writeFileSync(path.join(tmp, '.env.example'), 'ORDERS_PORT=\n# port\n');
    seedEnvModule(tmp, ['ORDERS_PORT', 'LOG_LEVEL']);
    const r = runIn(tmp);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /LOG_LEVEL/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('env-declared: .env.example key missing from schema fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envdec-'));
  try {
    fs.writeFileSync(path.join(tmp, '.env.example'), 'ORDERS_PORT=\nEXTRA_KEY=\n');
    seedEnvModule(tmp, ['ORDERS_PORT']);
    const r = runIn(tmp);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /EXTRA_KEY/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('env-declared: matching lists pass', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envdec-'));
  try {
    fs.writeFileSync(path.join(tmp, '.env.example'), 'ORDERS_PORT=\nLOG_LEVEL=\n');
    seedEnvModule(tmp, ['ORDERS_PORT', 'LOG_LEVEL']);
    const r = runIn(tmp);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('env.sh contains no regex reconstruction', () => {
  const body = fs.readFileSync(path.join(ROOT, 'harness', 'sensors', 'checks', 'env.sh'), 'utf8');
  assert.ok(!/stylish|RegExp|match\(/.test(body));
  assert.ok(body.includes('no-process-env'));
  assert.ok(body.includes('-f json'));
});
