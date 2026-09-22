import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config.mjs';
import { renderAdapter, listWiredEvents, PORTABLE_EVENTS } from '../render/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('default cursor adapter wires exactly four portable events', async () => {
  const config = loadConfig(ROOT);
  config.tool = 'cursor';
  config.hooks = { enable: true, failClosed: false };
  const events = listWiredEvents('cursor', config);
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((e) => e.event).sort(),
    [...PORTABLE_EVENTS].sort(),
  );
  assert.ok(!events.some((e) => /mcp/i.test(e.event)));
});

test('claude adapter wires exactly four events to verify.sh', async () => {
  const config = loadConfig(ROOT);
  config.tool = 'claude';
  config.hooks = { enable: true, failClosed: false };
  const events = listWiredEvents('claude', config);
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((e) => e.event).sort(),
    ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
  );
});

test('render cursor and claude produce complete adapters (one at a time)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-render-'));
  try {
    // Minimal tree for render
    fs.cpSync(path.join(ROOT, 'harness'), path.join(tmp, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'verify.sh'), '#!/bin/bash\n', { mode: 0o755 });
    fs.writeFileSync(
      path.join(tmp, 'harness.local.yaml'),
      'tool: cursor\nprofile: default\nhooks:\n  enable: true\n',
    );
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# test\n');
    fs.copyFileSync(path.join(ROOT, 'harness.yaml'), path.join(tmp, 'harness.yaml'));
    if (fs.existsSync(path.join(ROOT, 'harness', 'models.yaml'))) {
      /* already under harness/ */
    }

    const cursorCfg = loadConfig(tmp);
    cursorCfg.tool = 'cursor';
    cursorCfg.hooks = { enable: true };
    await renderAdapter(tmp, cursorCfg);
    assert.ok(fs.existsSync(path.join(tmp, '.cursor', 'hooks.json')));
    const hj = JSON.parse(
      fs.readFileSync(path.join(tmp, '.cursor', 'hooks.json'), 'utf8').replace(/^\/\/.*\n/gm, ''),
    );
    assert.equal(Object.keys(hj.hooks).length, 4);
    assert.ok(!('beforeMCPExecution' in hj.hooks));
    assert.ok(fs.existsSync(path.join(tmp, '.cursor', 'hooks', 'before-shell.sh')));
    assert.ok(!fs.existsSync(path.join(tmp, '.claude')));

    const claudeCfg = loadConfig(tmp);
    claudeCfg.tool = 'claude';
    claudeCfg.hooks = { enable: true };
    await renderAdapter(tmp, claudeCfg);
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'settings.json')));
    assert.ok(!fs.existsSync(path.join(tmp, '.cursor')));
    const settings = JSON.parse(
      fs
        .readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8')
        .replace(/^\/\/.*\n/gm, ''),
    );
    assert.equal(Object.keys(settings.hooks).length, 4);
    for (const script of ['session-start.sh', 'pre-tool.sh', 'post-tool.sh', 'stop.sh']) {
      assert.ok(fs.existsSync(path.join(tmp, '.claude', 'hooks', script)));
    }
    const claudeMd = fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeMd.startsWith('@AGENTS.md'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cursor thin hooks still refuse agent git commit', () => {
  const script = path.join(ROOT, 'harness', 'render', 'cursor', 'hooks', 'before-shell.sh');
  const r = spawnSync('bash', [script], {
    cwd: ROOT,
    input: JSON.stringify({ command: 'git commit -m x' }),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: ROOT },
  });
  assert.equal(r.status, 2);
});
