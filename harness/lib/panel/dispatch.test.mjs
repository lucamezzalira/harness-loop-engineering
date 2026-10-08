import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRoles } from './dispatch.mjs';
import { DEFAULTS } from '../config.mjs';

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
