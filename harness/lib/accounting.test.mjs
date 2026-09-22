import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordUsage, renderReport, writeSession } from './accounting.mjs';
import { FAKE_USAGE } from './agents/fake-provider.mjs';
import { invokeRole } from './agents/invoke.mjs';
import { loadConfig } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('fake provider: two-role panel over three turns has expected totals', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  delete process.env.HARNESS_FAKE_NO_USAGE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-acct-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    writeSession(tmp, {
      id: 'test-acct',
      startedAt: new Date().toISOString(),
      turns: 0,
      roles: {},
      units: {},
    });

    const config = loadConfig(ROOT);
    const binding = (role) => ({
      role,
      modelId: 'fake',
      provider: 'fake',
      tier: 'fast',
      providerMeta: { type: 'fake' },
    });

    for (let turn = 0; turn < 3; turn++) {
      for (const role of ['reviewer', 'product']) {
        const result = await invokeRole({
          root: tmp,
          config,
          binding: binding(role),
          systemPrompt: 'review',
          userPrompt: 'diff',
          expect: 'json',
        });
        assert.equal(result.ok, true);
        assert.equal(result.usage.inputTokens, FAKE_USAGE.inputTokens);
        recordUsage(tmp, {
          role,
          unitId: `U${turn + 1}`,
          usage: result.usage,
        });
      }
    }

    const text = renderReport(tmp);
    assert.match(text, /reviewer/);
    assert.match(text, /product/);
    // 3 turns × 2 roles = 6 calls each role has 3 calls
    assert.match(text, /reviewer\s+3/);
    assert.match(text, /product\s+3/);
    const expectedIn = FAKE_USAGE.inputTokens * 3;
    assert.ok(text.includes(String(expectedIn)), `expected in=${expectedIn} in:\n${text}`);
    assert.ok(!text.includes('(estimated)'), text);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fake provider with no usage marks report (estimated)', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  const prevNo = process.env.HARNESS_FAKE_NO_USAGE;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  process.env.HARNESS_FAKE_NO_USAGE = '1';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-acct-est-'));
  try {
    fs.mkdirSync(path.join(tmp, 'harness', 'state'), { recursive: true });
    writeSession(tmp, { id: 'est', roles: {}, units: {} });
    const config = loadConfig(ROOT);
    const result = await invokeRole({
      root: tmp,
      config,
      binding: {
        role: 'reviewer',
        modelId: 'fake',
        provider: 'fake',
        tier: 'fast',
        providerMeta: {},
      },
      systemPrompt: 'x',
      userPrompt: 'y',
      expect: 'json',
    });
    recordUsage(tmp, { role: 'reviewer', usage: result.usage });
    const text = renderReport(tmp);
    assert.match(text, /\(estimated\)/);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
    if (prevNo === undefined) delete process.env.HARNESS_FAKE_NO_USAGE;
    else process.env.HARNESS_FAKE_NO_USAGE = prevNo;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
