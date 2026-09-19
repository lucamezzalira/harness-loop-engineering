import { createPublisher } from '@acme/contracts';
import { env } from '../config/env.js';

/**
 * Billing service — consumes order.confirmed idempotently, publishes payment.captured.
 */
export function createBillingService({ bus, store = new Map() }) {
  const publisher = createPublisher(bus);
  const seen = new Set();

  bus.subscribe('order.confirmed', async (event) => {
    await handleOrderConfirmed(event);
  });

  async function handleOrderConfirmed(event) {
    const key = event.eventId;
    if (seen.has(key)) return { deduped: true };
    seen.add(key);
    store.set(event.orderId, {
      orderId: event.orderId,
      amountCents: event.totalCents,
      status: 'captured',
    });
    await publisher.publish('payment.captured', {
      eventId: `pay-${event.eventId}`,
      orderId: event.orderId,
      amountCents: event.totalCents,
    });
    return { deduped: false };
  }

  return {
    name: 'billing',
    env,
    handleOrderConfirmed,
    get(orderId) {
      return store.get(orderId) || null;
    },
  };
}
