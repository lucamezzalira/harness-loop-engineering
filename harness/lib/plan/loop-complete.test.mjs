import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isHarnessStateNoise,
  pathMatchesTouch,
  serialFallbackReason,
  shouldResumeLoop,
  shouldStallUnit,
  touchPathsHaveEvidence,
  unitLooksComplete,
  unitStallLimit,
} from './loop.mjs';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-complete-'));
  fs.mkdirSync(path.join(root, 'specs', 'demo'), { recursive: true });
  return root;
}

test('unitLooksComplete stays false for stub acceptance with no turns or files', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(
      path.join(root, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({
        entries: [{ id: 'A-05', passes: false, test: null }],
      }),
    );
    const unit = {
      id: 'U1',
      estimatedTurns: 3,
      touches: ['packages/shared/**'],
      acceptance: ['A-05'],
    };
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 0 }), false);
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 3 }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unitLooksComplete succeeds when estimatedTurns met and touch files exist', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(
      path.join(root, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({
        entries: [{ id: 'A-05', passes: false, test: null }],
      }),
    );
    fs.mkdirSync(path.join(root, 'packages', 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'shared', 'errors.mjs'), 'export {}\n');
    const unit = {
      id: 'U1',
      estimatedTurns: 3,
      touches: ['packages/shared/**'],
      acceptance: ['A-05'],
    };
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 2 }), false);
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 3 }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unitLooksComplete succeeds when linked tests all pass', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(
      path.join(root, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({
        entries: [
          { id: 'A-05', passes: true, test: 'packages/shared/errors.test.mjs' },
          { id: 'A-04', passes: true, test: 'services/orders/session.test.mjs' },
        ],
      }),
    );
    const unit = {
      id: 'U4',
      estimatedTurns: 4,
      touches: ['services/orders/**'],
      acceptance: ['A-04', 'A-05'],
    };
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 0 }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pathMatchesTouch and harness/state noise helpers', () => {
  assert.equal(pathMatchesTouch('packages/shared/errors.mjs', 'packages/shared/**'), true);
  assert.equal(pathMatchesTouch('infra/lib/data-stack.ts', 'infra/lib/data-stack.*'), true);
  assert.equal(pathMatchesTouch('services/billing/x.js', 'services/orders/**'), false);
  assert.equal(isHarnessStateNoise('harness/state/session.json'), true);
  assert.equal(isHarnessStateNoise('packages/shared/x.mjs'), false);
});

test('serialFallbackReason matches worktree outcome', () => {
  const merged = new Set();
  assert.match(
    serialFallbackReason('U1', { U1: 'invoke-failed' }, merged, {}),
    /invoke failed/,
  );
  assert.match(
    serialFallbackReason('U2', { U2: 'no-changes' }, merged, {}),
    /produced no changes/,
  );
  assert.match(
    serialFallbackReason('U3', { U3: 'worktree-done' }, merged, {}),
    /no mergeable changes/,
  );
  assert.match(
    serialFallbackReason('U4', {}, merged, { U4: 'worktree-done' }),
    /no mergeable changes/,
  );
  assert.match(
    serialFallbackReason('U5', {}, merged, { U5: 'incomplete' }),
    /incomplete after parallel wave/,
  );
});

test('touchPathsHaveEvidence sees files under touch globs', () => {
  const root = makeRoot();
  try {
    assert.equal(touchPathsHaveEvidence(root, ['services/orders/**']), false);
    fs.mkdirSync(path.join(root, 'services', 'orders'), { recursive: true });
    fs.writeFileSync(path.join(root, 'services', 'orders', 'index.js'), '// shell\n');
    assert.equal(touchPathsHaveEvidence(root, ['services/orders/**']), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unitLooksComplete matches A-01: description plan refs to acceptance.json', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(
      path.join(root, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({
        entries: [{ id: 'A-05', passes: true, test: 'packages/shared/errors.test.mjs' }],
      }),
    );
    const unit = {
      id: 'U1',
      estimatedTurns: 3,
      touches: ['packages/shared/**'],
      acceptance: ['A-05: Shared errors helper'],
    };
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 0 }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shouldStallUnit at estimatedTurns with no touch evidence', () => {
  const root = makeRoot();
  try {
    const unit = {
      id: 'U2',
      estimatedTurns: 6,
      touches: ['init/src/utils/masonry.js'],
      acceptance: ['A-01'],
    };
    assert.equal(shouldStallUnit(root, unit, 5, {}), false);
    assert.equal(shouldStallUnit(root, unit, 6, {}), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shouldStallUnit waits for stall limit when evidence exists but unit never completes', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'services', 'orders'), { recursive: true });
    fs.writeFileSync(path.join(root, 'services', 'orders', 'index.js'), 'export {}\n');
    fs.writeFileSync(
      path.join(root, 'specs', 'demo', 'acceptance.json'),
      JSON.stringify({
        entries: [{ id: 'A-01', passes: false, test: 'services/orders/missing.test.mjs' }],
      }),
    );
    const unit = {
      id: 'U2',
      estimatedTurns: 0,
      touches: ['services/orders/**'],
      acceptance: ['A-01'],
    };
    assert.equal(unitLooksComplete(root, unit, { unitTurns: 20 }), false);
    assert.equal(unitStallLimit(unit, { loop: { unitStallFactor: 2 } }), 6);
    assert.equal(shouldStallUnit(root, unit, 3, { loop: { unitStallFactor: 2 } }), false);
    assert.equal(shouldStallUnit(root, unit, 6, { loop: { unitStallFactor: 2 } }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shouldResumeLoop skips unclosable units', () => {
  const plan = { units: [{ id: 'U1' }, { id: 'U2' }] };
  assert.equal(
    shouldResumeLoop(plan, { unitStatus: { U1: 'complete', U2: 'unclosable' } }),
    false,
  );
  assert.equal(
    shouldResumeLoop(plan, { unitStatus: { U1: 'complete', U2: 'incomplete' } }),
    true,
  );
  assert.equal(
    shouldResumeLoop(plan, {
      stopReason: 'ship-panel-blocking',
      unitStatus: { U1: 'complete', U2: 'complete' },
    }),
    true,
  );
});
