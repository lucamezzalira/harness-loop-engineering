import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeRole } from './invoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('A-06 a deleted test fixture expects check-weakened', async () => {
  const prev = process.env.HARNESS_FAKE_PROVIDER;
  process.env.HARNESS_FAKE_PROVIDER = '1';
  try {
    const diff = fs.readFileSync(
      path.join(ROOT, 'harness', 'lib', 'agents', 'fixtures', 'deleted-test.diff'),
      'utf8',
    );
    const systemPrompt = fs.readFileSync(
      path.join(ROOT, 'harness', 'roles', 'integrity-checker.md'),
      'utf8',
    );
    assert.match(systemPrompt, /check-weakened/);
    assert.match(diff, /deleted file mode/);

    const result = await invokeRole({
      root: ROOT,
      config: { tool: 'cursor' },
      binding: { role: 'integrity-checker', tier: 'deep', modelId: 'fake', provider: 'fake' },
      systemPrompt,
      userPrompt: diff,
      expect: 'json',
    });
    assert.equal(result.ok, true);
    assert.equal(result.path, 'fake');
    assert.equal(result.data.verdict, 'FAIL');
    assert.equal(result.data.findings[0].category, 'check-weakened');
    assert.equal(result.data.findings[0].file, 'services/orders/charge.test.mjs');

    const quiet = await invokeRole({
      root: ROOT,
      config: { tool: 'cursor' },
      binding: { role: 'integrity-checker', tier: 'deep', modelId: 'fake', provider: 'fake' },
      systemPrompt,
      userPrompt: 'diff --git a/README.md b/README.md\n+hello\n',
      expect: 'json',
    });
    assert.equal(quiet.data.verdict, 'PASS');
    assert.equal(quiet.data.findings.length, 0);

    const stripped = await invokeRole({
      root: ROOT,
      config: { tool: 'cursor' },
      binding: { role: 'integrity-checker', tier: 'deep', modelId: 'fake', provider: 'fake' },
      systemPrompt: 'Compare the diff. Return a verdict.',
      userPrompt: diff,
      expect: 'json',
    });
    assert.equal(stripped.data.verdict, 'PASS');
    assert.equal(stripped.data.findings.length, 0);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_PROVIDER;
    else process.env.HARNESS_FAKE_PROVIDER = prev;
  }
});
