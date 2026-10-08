import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { touchPrefixAllowed, validatePlan, normalizePlanAcceptance } from './validate-plan.mjs';

test('touchPrefixAllowed rejects invented init/src', () => {
  assert.equal(touchPrefixAllowed('services/orders/**'), true);
  assert.equal(touchPrefixAllowed('examples/two-services/**'), true);
  assert.equal(touchPrefixAllowed('init/prds/01.md'), true);
  assert.equal(touchPrefixAllowed('init/src/components/**'), false);
});

test('validatePlan fails empty touches and bad roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-plan-'));
  try {
    const plan = {
      units: [
        { id: 'U1', touches: [], acceptance: [] },
        { id: 'U2', touches: ['init/src/x.js'], acceptance: [] },
      ],
    };
    const r = validatePlan(root, plan, { requireAcceptanceFile: false });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('U1') && e.includes('empty')));
    assert.ok(r.errors.some((e) => e.includes('U2') && e.includes('init/src')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validatePlan requires acceptance ids when file exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-plan-'));
  try {
    fs.mkdirSync(path.join(root, 'specs', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({ entries: [{ id: 'A-01', passes: false, test: null }] }),
    );
    const plan = normalizePlanAcceptance({
      units: [
        {
          id: 'U2',
          touches: ['services/orders/**'],
          acceptance: ['A-01: mobile masonry'],
        },
      ],
    });
    assert.deepEqual(plan.units[0].acceptance, ['A-01']);
    const ok = validatePlan(root, plan, { prdSlug: 'demo' });
    assert.equal(ok.ok, true);

    const bad = validatePlan(
      root,
      { units: [{ id: 'U9', touches: ['services/orders/**'], acceptance: ['A-99'] }] },
      { prdSlug: 'demo' },
    );
    assert.equal(bad.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
