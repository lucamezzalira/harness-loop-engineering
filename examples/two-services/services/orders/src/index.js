import { createPublisher } from '@acme/contracts';
import { env } from '../config/env.js';

/**
 * Orders service — confirms orders and publishes order.confirmed.
 */
export function createOrdersService({ bus, store = new Map() }) {
  const publisher = createPublisher(bus);

  return {
    name: 'orders',
    env,
    async confirmOrder({ orderId, totalCents }) {
      if (!orderId) throw new Error('orderId required');
      const eventId = `evt-${orderId}-${Date.now()}`;
      store.set(orderId, { orderId, totalCents, status: 'confirmed' });
      await publisher.publish('order.confirmed', { eventId, orderId, totalCents });
      return store.get(orderId);
    },
    get(orderId) {
      return store.get(orderId) || null;
    },
  };
}
