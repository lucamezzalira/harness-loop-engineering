import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFindings, partitionByPolicy } from './panel/merge.mjs';
import { validateSeverityMap, mapCategory } from './severity.mjs';

test('unknown category maps to default', () => {
  const map = validateSeverityMap({
    default: 'P2',
    'secret-exposed': 'P0',
  }).map;
  assert.equal(mapCategory('totally-new', map), 'P2');
});

test('nested severity.categories shape normalizes', () => {
  const r = validateSeverityMap({
    categories: { 'secret-exposed': 'P0', naming: 'P3' },
    default: 'P2',
  });
  assert.equal(r.ok, true);
  assert.equal(r.map['secret-exposed'], 'P0');
  assert.equal(mapCategory('naming', r.map), 'P3');
  assert.equal(mapCategory('unknown', r.map), 'P2');
});

test('dedupe keeps higher mapped severity', () => {
  const map = { default: 'P2', naming: 'P3', 'error-swallowed': 'P1' };
  const merged = mergeFindings(
    [
      { role: 'reviewer', category: 'naming', file: 'a.js', line: 10, endLine: 12, message: 'x' },
      {
        role: 'qa',
        category: 'error-swallowed',
        file: 'a.js',
        line: 11,
        endLine: 11,
        message: 'x',
      },
    ],
    map,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].severity, 'P1');
});

test('partition blocks P0/P1', () => {
  const { blocking, backlogged } = partitionByPolicy(
    [
      { severity: 'P0', message: 'a' },
      { severity: 'P2', message: 'b' },
    ],
    ['P0', 'P1'],
  );
  assert.equal(blocking.length, 1);
  assert.equal(backlogged.length, 1);
});
