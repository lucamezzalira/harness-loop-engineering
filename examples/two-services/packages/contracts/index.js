/**
 * Shared contracts package — only permitted cross-service import.
 * All publishes go through `publish`.
 */

const schemas = {
  'order.confirmed': {
    type: 'object',
    required: ['eventId', 'orderId', 'totalCents'],
    properties: {
      eventId: { type: 'string' },
      orderId: { type: 'string' },
      totalCents: { type: 'number' },
    },
  },
  'payment.captured': {
    type: 'object',
    required: ['eventId', 'orderId', 'amountCents'],
    properties: {
      eventId: { type: 'string' },
      orderId: { type: 'string' },
      amountCents: { type: 'number' },
    },
  },
};

function validate(eventType, payload) {
  const schema = schemas[eventType];
  if (!schema) throw new Error(`unknown event type: ${eventType}`);
  for (const key of schema.required) {
    if (payload[key] == null) throw new Error(`missing ${key} for ${eventType}`);
  }
  return payload;
}

/**
 * Typed publisher. Callers must not emit events by reaching into another service.
 * @param {{ publish: (type: string, payload: object) => Promise<void> }} bus
 */
export function createPublisher(bus) {
  return {
    async publish(eventType, payload) {
      const body = validate(eventType, payload);
      await bus.publish(eventType, body);
      return body;
    },
  };
}

export { schemas, validate };
