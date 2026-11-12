import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDeterministicSection, composeWaveRetro } from './retro.mjs';

const stats = {
  turnsByUnit: { U2: 2, U1: 1 },
  costByUnit: { U1: 0.1, U2: 0.2 },
  checks: [
    { name: 'unit', failed: 1, streak: 2 },
    { name: 'format', failed: 0, streak: 0 },
  ],
  stalls: ['U2'],
  unclosable: [],
  needsHuman: ['U3'],
  panelCategories: { reviewer: { style: 1 } },
  mutants: [{ file: 'a.js', line: 1 }],
  timeByUnit: { U1: 3 },
  dismissedByRole: { reviewer: '1/2' },
};

const config = {
  profile: 'default',
  tool: 'cursor',
  models: {
    profiles: { default: { reviewer: 'deep' } },
    tiers: { deep: { provider: 'anthropic', id: 'fake-model' } },
    providers: { anthropic: { type: 'anthropic' } },
  },
};

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs));
    else out.push(abs);
  }
  return out.sort();
}

test('A-14 A-15 wave retro has both sections and is stable', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-retro-'));
  try {
    const first = await composeWaveRetro(tmp, config, {
      sessionId: 's1',
      wave: 1,
      stats,
      proposedRules: 'style showed up twice',
    });
    const second = await composeWaveRetro(tmp, config, {
      sessionId: 's1',
      wave: 2,
      stats,
      proposedRules: 'style showed up twice',
    });
    const again = await composeWaveRetro(tmp, config, {
      sessionId: 's1',
      wave: 2,
      stats,
      proposedRules: 'style showed up twice',
    });
    for (const file of [first, second]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /## Deterministic/);
      assert.match(text, /## Proposals/);
      assert.match(text, /style showed up twice|format failed/);
      assert.doesNotMatch(text, /fourth item/);
    }
    assert.equal(fs.readFileSync(second, 'utf8'), fs.readFileSync(again, 'utf8'));
    assert.equal(buildDeterministicSection(stats), buildDeterministicSection(stats));
  } finally {
    if (prev == null) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('A-16 retro generation only writes under harness/retro', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-retro-scope-'));
  fs.writeFileSync(path.join(tmp, 'README'), 'stay\n');
  const before = listFiles(tmp);
  try {
    await composeWaveRetro(tmp, config, { sessionId: 's9', wave: 1, stats, proposedRules: '' });
    const after = listFiles(tmp);
    const added = after.filter((file) => !before.includes(file));
    assert.ok(added.length >= 1);
    for (const file of added) {
      assert.match(path.relative(tmp, file), /^harness\/retro\//);
    }
    assert.equal(fs.existsSync(path.join(tmp, 'HANDOFF.md')), false);
  } finally {
    if (prev == null) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
