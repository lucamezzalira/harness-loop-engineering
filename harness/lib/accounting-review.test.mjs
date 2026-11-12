import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcome, renderReviewMetrics } from './accounting-review.mjs';

test('A-27 review metrics list findings, outcomes, cycles, and human stops', () => {
  const text = renderReviewMetrics(
    {
      reviewFindings: [
        { role: 'reviewer', category: 'style', outcome: 'fixed' },
        { role: 'security', category: 'secret-exposed', outcome: 'dismissed' },
      ],
      panelCycles: { U2: 1, U1: 2 },
      unitStatus: { U1: 'needs-human', U2: 'unclosable', U3: 'complete' },
      checkEditRefusals: 4,
    },
    { revertRate: { value: '1/10', estimated: false } },
  );
  assert.match(text, /reviewer\/style: 1/);
  assert.match(text, /security\/secret-exposed: dismissed/);
  assert.match(text, /reviewer\/style: fixed/);
  assert.match(text, /U1: 2/);
  assert.match(text, /needs-human: 1/);
  assert.match(text, /unclosable: 1/);
  assert.match(text, /check-integrity refusals: 4/);
  assert.match(text, /revert rate: 1\/10/);
  assert.match(text, /escape rate: out of scope/);
});

test('A-28 inferred outcomes are marked estimated', () => {
  assert.equal(classifyOutcome({ outcome: 'dismissed' }), 'dismissed');
  const text = renderReviewMetrics(
    { reviewFindings: [{ role: 'qa', category: 'acceptance-unmet' }] },
    { revertRate: { value: 'unknown', estimated: true } },
  );
  assert.match(text, /qa\/acceptance-unmet: open \(estimated\)/);
  assert.match(text, /revert rate: unknown \(estimated\)/);
});
