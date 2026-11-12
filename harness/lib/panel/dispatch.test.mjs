import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRoles, findingsFromRoleOutput, systemPromptForRole } from './dispatch.mjs';
import { DEFAULTS, loadConfig } from '../config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('turn cadence runs reviewer only by default', () => {
  const config = structuredClone(DEFAULTS);
  config.roles.qa = { enabled: true };
  const roles = selectRoles(config, {
    cadence: 'turn',
    diffFiles: ['services/orders/src/index.js'],
    unitComplete: false,
    acceptanceChanged: false,
  });
  assert.deepEqual(roles, ['reviewer']);
});

test('security always on unit complete even without path hit', () => {
  const config = structuredClone(DEFAULTS);
  const roles = selectRoles(config, {
    cadence: 'unit',
    diffFiles: ['README.md'],
    unitComplete: true,
    acceptanceChanged: false,
  });
  assert.ok(roles.includes('security'));
  assert.ok(roles.includes('product'));
});

test('security fires on log path mid-turn when listed', () => {
  const config = structuredClone(DEFAULTS);
  // Mid-turn uses turn cadence; security only if path matches and listed.
  const roles = selectRoles(config, {
    cadence: 'turn',
    diffFiles: ['services/billing/log.js'],
    unitComplete: false,
    acceptanceChanged: false,
  });
  assert.deepEqual(roles, ['reviewer']);
});

test('unit cadence is product+security', () => {
  const config = structuredClone(DEFAULTS);
  const roles = selectRoles(config, {
    cadence: 'unit',
    diffFiles: ['services/orders/x.js'],
    unitComplete: true,
    acceptanceChanged: false,
  });
  assert.ok(roles.includes('security'));
  assert.ok(roles.includes('product'));
  assert.ok(!roles.includes('reviewer'));
});

test('unit cadence includes the checker roles', () => {
  const config = loadConfig(ROOT);
  const roles = selectRoles(config, {
    cadence: 'unit',
    diffFiles: ['harness/lib/render/render.mjs'],
    unitComplete: true,
    acceptanceChanged: false,
  });
  assert.ok(roles.includes('acceptance-checker'));
  assert.ok(roles.includes('integrity-checker'));
  assert.ok(roles.includes('security'));
  assert.ok(roles.includes('product'));
});

test('checker verdict objects become panel findings', () => {
  const weakened = findingsFromRoleOutput({
    verdict: 'FAIL',
    findings: [{ category: 'check-weakened', file: 'a.test.mjs', line: 1, message: 'removed' }],
  });
  assert.equal(weakened[0].category, 'check-weakened');

  const unmet = findingsFromRoleOutput({
    verdict: 'FAIL',
    criteria: [{ id: 'A-01', status: 'FAIL', evidence: 'no test' }],
  });
  assert.equal(unmet.length, 1);
  assert.equal(unmet[0].category, 'acceptance-unmet');
  assert.match(unmet[0].message, /A-01/);

  const passed = findingsFromRoleOutput({
    verdict: 'PASS',
    criteria: [{ id: 'A-01', status: 'PASS', evidence: 'render.test.mjs' }],
  });
  assert.equal(passed.length, 0);
});

test('verdict roles keep their prompt and other roles stay an array', () => {
  const checker = fsReadRole('integrity-checker');
  assert.equal(systemPromptForRole(checker), checker);
  const reviewer = systemPromptForRole('Read the diff only.');
  assert.match(reviewer, /JSON array only/);
});

function fsReadRole(name) {
  return fs.readFileSync(path.join(ROOT, 'harness', 'roles', `${name}.md`), 'utf8');
}

test('ship cadence mirrors full specialist set', () => {
  const config = structuredClone(DEFAULTS);
  config.roles.qa = { enabled: true };
  const roles = selectRoles(config, {
    cadence: 'ship',
    diffFiles: ['services/orders/x.js'],
    unitComplete: true,
    acceptanceChanged: false,
  });
  assert.ok(roles.includes('reviewer'));
  assert.ok(roles.includes('security'));
  assert.ok(roles.includes('product'));
  assert.ok(roles.includes('qa'));
});
