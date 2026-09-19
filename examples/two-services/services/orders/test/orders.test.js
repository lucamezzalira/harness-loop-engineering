import test from 'node:test';
import assert from 'node:assert/strict';
import { createInProcessBus } from '../../../bus/index.js';
import { createOrdersService } from '../src/index.js';

test('confirmOrder publishes order.confirmed', async () => {
  const seen = [];
  const bus = createInProcessBus();
  bus.subscribe('order.confirmed', async (p) => seen.push(p));
  const orders = createOrdersService({ bus });
  const result = await orders.confirmOrder({ orderId: 'o-1', totalCents: 2500 });
  assert.equal(result.status, 'confirmed');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].orderId, 'o-1');
});
