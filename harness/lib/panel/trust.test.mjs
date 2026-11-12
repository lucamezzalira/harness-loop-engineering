import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMode, routeFindings } from './trust.mjs';

const finding = {
  role: 'reviewer',
  category: 'error-swallowed',
  severity: 'P1',
  file: 'a.js',
  line: 1,
  message: 'swallowed',
};

test('A-29 the same P1 finding blocks, backlogs, or stays in the review file', () => {
  const blocking = routeFindings([finding], 'blocking', ['P0', 'P1']);
  assert.equal(blocking.blocking.length, 1);
  assert.equal(blocking.backlogged.length, 0);
  assert.equal(blocking.shadow.length, 0);

  const advisory = routeFindings([finding], 'advisory', ['P0', 'P1']);
  assert.equal(advisory.blocking.length, 0);
  assert.equal(advisory.backlogged.length, 1);
  assert.equal(advisory.shadow.length, 0);

  const shadow = routeFindings([finding], 'shadow', ['P0', 'P1']);
  assert.equal(shadow.blocking.length, 0);
  assert.equal(shadow.backlogged.length, 0);
  assert.equal(shadow.shadow.length, 1);
});

test('A-30 current roles default to blocking and an unlisted role defaults to shadow', () => {
  for (const role of ['reviewer', 'security', 'product', 'acceptance-checker', 'integrity-checker']) {
    assert.equal(reviewMode({}, role), 'blocking', role);
  }
  assert.equal(reviewMode({}, 'brand-new'), 'shadow');
  assert.equal(reviewMode({ review: { mode: { reviewer: 'advisory' } } }, 'reviewer'), 'advisory');
});
