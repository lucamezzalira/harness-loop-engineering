import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function skill(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function bodyLines(text) {
  const end = text.indexOf('\n---\n');
  const body = end >= 0 ? text.slice(end + 5) : text;
  return body.split('\n').length;
}

test('A-25 fix-an-escape interviews, then proves a regression, then records ESC-NN', () => {
  const text = skill('harness/skills/fix-an-escape/SKILL.md');
  assert.match(text, /one question at a time/i);
  assert.match(text, /Write nothing before the answers/);
  assert.match(text, /confirm it fails/);
  assert.match(text, /confirm it passes/);
  assert.match(text, /ESC-NN/);
  assert.match(text, /qa role/);
});

test('A-32 skills interview before they write', () => {
  for (const rel of [
    'harness/skills/write-a-prd/SKILL.md',
    'harness/skills/write-an-adr/SKILL.md',
    'harness/skills/add-an-endpoint/SKILL.md',
    'harness/skills/add-a-consumer/SKILL.md',
  ]) {
    const text = skill(rel);
    assert.match(text, /one question at a time/i, rel);
    assert.match(text, /Write nothing before the answers/, rel);
    const interview = text.toLowerCase().indexOf('one question at a time');
    const write = text.toLowerCase().indexOf('after those answers');
    assert.ok(interview >= 0 && write > interview, rel);
  }
});

test('A-33 skill bodies stay under 500 lines', () => {
  const skills = [
    'harness/skills/write-a-prd/SKILL.md',
    'harness/skills/write-an-adr/SKILL.md',
    'harness/skills/add-an-endpoint/SKILL.md',
    'harness/skills/add-a-consumer/SKILL.md',
    'harness/skills/fix-an-escape/SKILL.md',
  ];
  for (const rel of skills) {
    assert.ok(bodyLines(skill(rel)) < 500, rel);
  }
});
