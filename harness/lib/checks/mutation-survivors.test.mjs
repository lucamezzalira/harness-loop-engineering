import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { mutationWhere, survivorsToFindings } from './mutation-survivors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('A-19 three survivors on one line become one finding', () => {
  const mutants = [1, 2, 3].map((n) => ({
    status: 'Survived',
    file: 'services/billing/charge.js',
    line: 12,
    mutatorName: `m${n}`,
  }));
  const findings = survivorsToFindings(
    { mutants },
    { changedFiles: ['services/billing/charge.js'] },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'mutant-survived');
  assert.equal(findings[0].severity, 'P2');
  assert.equal(findings[0].line, 12);
});

test('A-20 survivor findings are capped at 7 times the changed file count', () => {
  const mutants = [];
  for (const file of ['a.js', 'b.js']) {
    for (let line = 1; line <= 15; line += 1) {
      mutants.push({ status: 'survived', file, line, mutatorName: 'cond' });
    }
  }
  const findings = survivorsToFindings({ mutants }, { changedFiles: ['a.js', 'b.js'] });
  assert.equal(mutants.length, 30);
  assert.ok(findings.length <= 14);
  assert.equal(findings.length, 14);
});

test('A-21 mutation stays non-blocking and ci-only unless mutation.local is set', () => {
  const doc = parseYaml(
    fs.readFileSync(path.join(ROOT, 'harness', 'sensors', 'sensors.yaml'), 'utf8'),
  );
  const sensor = doc.sensors.find((s) => s.name === 'mutation');
  assert.equal(sensor.blocking, false);
  assert.deepEqual(sensor.where, ['ci']);
  assert.deepEqual(mutationWhere({ mutation: { local: false } }, sensor.where), ['ci']);
  assert.deepEqual(mutationWhere({ mutation: { local: true } }, sensor.where), ['local', 'ci']);
});
