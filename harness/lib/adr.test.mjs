import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('AGENTS.md stays within limits and has required sections', () => {
  const text = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const lines = text.split('\n').length;
  assert.ok(lines <= 200, `AGENTS.md has ${lines} lines (max 200)`);
  assert.ok(lines >= 40, `AGENTS.md has ${lines} lines (min 40)`);
  for (const h of [
    '## Setup commands',
    '## What done means',
    '## Project structure',
    '## Architecture',
    '## Boundaries',
  ]) {
    assert.ok(text.includes(h), `missing section ${h}`);
  }
});

test('build-adr-index --check passes on committed README', () => {
  const r = spawnSync(process.execPath, ['scripts/build-adr-index.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('adr-frontmatter check passes', () => {
  const r = spawnSync(process.execPath, ['scripts/check-adr-frontmatter.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: ROOT },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('render emits ADR consult rule for cursor', async () => {
  const { loadConfig } = await import('./config.mjs');
  const { renderAdapter } = await import('./render/render.mjs');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-rule-'));
  try {
    fs.cpSync(path.join(ROOT, 'harness'), path.join(tmp, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'verify.sh'), '#!/bin/bash\n', { mode: 0o755 });
    fs.writeFileSync(path.join(tmp, 'harness.yaml'), fs.readFileSync(path.join(ROOT, 'harness.yaml')));
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# x\n');
    fs.writeFileSync(
      path.join(tmp, 'harness.local.yaml'),
      'tool: cursor\nprofile: default\nhooks:\n  enable: true\n',
    );
    const config = loadConfig(tmp);
    config.tool = 'cursor';
    await renderAdapter(tmp, config);
    const rule = path.join(
      tmp,
      '.cursor',
      'rules',
      'consult-adr-before-architectural-change.mdc',
    );
    assert.ok(fs.existsSync(rule), 'missing cursor rule');
    const body = fs.readFileSync(rule, 'utf8');
    assert.ok(body.includes('globs:'));
    assert.ok(body.includes('harness/**'));
    assert.ok(body.includes('## Signals of violation'));
    assert.ok(body.includes('shall'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rule-shape check passes on repo rules', () => {
  const r = spawnSync(process.execPath, ['scripts/check-rule-shape.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: ROOT },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
