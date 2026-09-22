import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../plan/plan.mjs';
import { loadConfig } from '../config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('--plan against example PRD produces multi-unit plan.json (fake provider)', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  try {
    const config = loadConfig(ROOT);
    config.confirmProfile = false;
    config.loop = {
      ...config.loop,
      prd: 'specs/example-idempotent-consumers/PRD.md',
      gate: 'never',
    };
    const r = await runPlan(ROOT, config);
    assert.equal(r.exitCode, 0, r.message);
    const planPath = path.join(ROOT, 'harness', 'state', 'plan.json');
    assert.ok(fs.existsSync(planPath), 'plan.json missing');
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.ok(Array.isArray(plan.units) && plan.units.length > 1, JSON.stringify(plan.units));
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
  }
});
