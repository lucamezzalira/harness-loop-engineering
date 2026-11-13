import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeRole } from './invoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function verdictOf(result) {
  if (!result || !('data' in result) || !result.data) return undefined;
  return result.data.verdict;
}

test('A-56 report-against-prd names the four sections and the verdict line', () => {
  const skill = fs.readFileSync(
    path.join(ROOT, 'harness', 'skills', 'report-against-prd', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /Criteria/);
  assert.match(skill, /Wiring proof/);
  assert.match(skill, /Bypass check/);
  assert.match(skill, /Known gaps and rerun commands/);
  assert.match(skill, /acceptance-checker: PASS/);
});

test('A-57 acceptance-checker fixtures fail for the three duties', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  try {
    const systemPrompt = fs.readFileSync(
      path.join(ROOT, 'harness', 'roles', 'acceptance-checker.md'),
      'utf8',
    );
    assert.match(systemPrompt, /every field the diff reads has a writer/i);
    assert.match(systemPrompt, /helper on its own/);
    assert.match(systemPrompt, /shell route/);
    const fixtures = [
      'a field is read but never written',
      'an end-to-end criterion tested only through a helper',
      'a protection with no shell-route test',
    ];
    for (const userPrompt of fixtures) {
      const result = await invokeRole({
        root: ROOT,
        config: { tool: 'cursor' },
        binding: { role: 'acceptance-checker', tier: 'deep', modelId: 'fake', provider: 'fake' },
        systemPrompt,
        userPrompt,
        expect: 'json',
      });
      assert.equal(verdictOf(result), 'FAIL', userPrompt);
    }
    const stripped = await invokeRole({
      root: ROOT,
      config: { tool: 'cursor' },
      binding: { role: 'acceptance-checker', tier: 'deep', modelId: 'fake', provider: 'fake' },
      systemPrompt: 'Return a verdict.',
      userPrompt: fixtures[0],
      expect: 'json',
    });
    assert.equal(verdictOf(stripped), 'PASS');
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
  }
});
