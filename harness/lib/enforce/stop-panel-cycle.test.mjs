import test from 'node:test';
import assert from 'node:assert/strict';
import { turnPanelCycleCount } from './stop.mjs';
import { renderReviewTable } from '../panel/merge.mjs';

test('turnPanelCycleCount ignores object-shaped legacy panelCycles', () => {
  assert.equal(turnPanelCycleCount({ panelCycles: {} }), 0);
  assert.equal(turnPanelCycleCount({ panelCycles: { U1: 2 } }), 0);
  assert.equal(turnPanelCycleCount({ panelCycles: 2 }), 2);
});

test('review table cycle is numeric when session had object panelCycles', () => {
  const legacySession = { panelCycles: {} };
  const cycle = turnPanelCycleCount(legacySession) + 1;
  assert.equal(cycle, 1);
  assert.equal(typeof cycle, 'number');
  const table = renderReviewTable({ blocking: [], backlogged: [], unitId: 'U1', cycle });
  assert.match(table, /cycle 1 ·/);
  assert.doesNotMatch(table, /\[object Object\]/);
});
