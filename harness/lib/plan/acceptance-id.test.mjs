import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAcceptanceId, normalizeAcceptanceIds } from './acceptance-id.mjs';

test('normalizeAcceptanceId strips description', () => {
  assert.equal(
    normalizeAcceptanceId('A-01: 390 px phone, 150 elements: 2 columns'),
    'A-01',
  );
  assert.equal(normalizeAcceptanceId('a-12'), 'A-12');
  assert.equal(normalizeAcceptanceId('A-03'), 'A-03');
});

test('normalizeAcceptanceIds dedupes', () => {
  assert.deepEqual(
    normalizeAcceptanceIds(['A-01: foo', 'A-01', 'A-02: bar']),
    ['A-01', 'A-02'],
  );
});
