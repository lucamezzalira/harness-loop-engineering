import test from 'node:test';
import assert from 'node:assert/strict';
import { createInProcessBus } from '../../../bus/index.js';
import { createBillingService } from '../src/index.js';

test('billing is idempotent on eventId', async () => {
  const bus = createInProcessBus();
  const billing = createBillingService({ bus });
  const event = { eventId: 'e-1', orderId: 'o-1', totalCents: 1000 };
  const first = await billing.handleOrderConfirmed(event);
  const second = await billing.handleOrderConfirmed(event);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(billing.get('o-1').status, 'captured');
});
