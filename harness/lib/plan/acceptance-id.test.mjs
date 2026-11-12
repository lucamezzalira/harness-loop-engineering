import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAcceptanceId, normalizeAcceptanceIds } from './acceptance-id.mjs';

test('normalizeAcceptanceId strips description', () => {
  assert.equal(normalizeAcceptanceId('A-01: 390 px phone, 150 elements: 2 columns'), 'A-01');
  assert.equal(normalizeAcceptanceId('a-12'), 'A-12');
  assert.equal(normalizeAcceptanceId('A-03'), 'A-03');
});

test('A-26 accepts ESC-NN beside A-NN', () => {
  assert.equal(normalizeAcceptanceId('ESC-01: billing double charge'), 'ESC-01');
  assert.equal(normalizeAcceptanceId('esc-12'), 'ESC-12');
  assert.deepEqual(normalizeAcceptanceIds(['A-01', 'ESC-02: retry']), ['A-01', 'ESC-02']);
});

test('normalizeAcceptanceIds dedupes', () => {
  assert.deepEqual(normalizeAcceptanceIds(['A-01: foo', 'A-01', 'A-02: bar']), ['A-01', 'A-02']);
});
