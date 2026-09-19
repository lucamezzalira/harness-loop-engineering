import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublisher, validate } from '../index.js';

test('validate accepts order.confirmed', () => {
  const p = validate('order.confirmed', {
    eventId: 'e1',
    orderId: 'o1',
    totalCents: 100,
  });
  assert.equal(p.orderId, 'o1');
});

test('publisher rejects unknown type', async () => {
  const bus = { publish: async () => {} };
  const pub = createPublisher(bus);
  await assert.rejects(() => pub.publish('nope', {}), /unknown event type/);
});
