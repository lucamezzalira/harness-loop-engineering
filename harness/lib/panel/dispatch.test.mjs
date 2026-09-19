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

test('security skipped when paths do not match', () => {
  const config = structuredClone(DEFAULTS);
  const roles = selectRoles(config, {
    cadence: 'unit',
    diffFiles: ['README.md'],
    unitComplete: true,
    acceptanceChanged: false,
  });
  assert.ok(!roles.includes('security'));
});

test('security fires on log path', () => {
  const config = structuredClone(DEFAULTS);
  const roles = selectRoles(config, {
    cadence: 'unit',
    diffFiles: ['services/billing/log.js'],
    unitComplete: false,
    acceptanceChanged: false,
  });
  assert.ok(roles.includes('security'));
});
