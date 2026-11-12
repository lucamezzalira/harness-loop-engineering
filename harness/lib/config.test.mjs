import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveRoleBinding } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('checker roles bind like reviewer without a models.yaml entry', () => {
  const models = fs.readFileSync(path.join(ROOT, 'harness', 'models.yaml'), 'utf8');
  assert.doesNotMatch(models, /acceptance-checker/);
  assert.doesNotMatch(models, /integrity-checker/);

  const config = loadConfig(ROOT);
  const reviewer = resolveRoleBinding(config, 'reviewer');
  for (const role of ['acceptance-checker', 'integrity-checker']) {
    const binding = resolveRoleBinding(config, role);
    assert.equal(binding.role, role);
    assert.equal(binding.tier, reviewer.tier);
    assert.equal(binding.modelId, reviewer.modelId);
    assert.equal(binding.provider, reviewer.provider);
  }
});
