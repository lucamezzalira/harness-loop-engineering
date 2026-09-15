import { randomUUID } from 'node:crypto'
import type { EventBus, SubscriberConfirmed } from '../../../packages/contracts/src/index.js'
import { assertSubscriberConfirmed } from '../../../packages/contracts/src/index.js'
import { DuplicateSubscriberError, type SubscriberStore } from './store.js'
import { validateSubscribeEmail, ValidationError } from './validate.js'

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

export type SubscribeResult =
  | { ok: true; subscriberId: string; event: SubscriberConfirmed }
  | { ok: false; statusCode: number; error: string }

export async function subscribe(
  store: SubscriberStore,
  bus: EventBus,
  log: Logger,
  body: unknown,
): Promise<SubscribeResult> {
  try {
    const email = validateSubscribeEmail(
      typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined,
    )

    const subscriber = {
      id: randomUUID(),
      email,
      createdAt: new Date().toISOString(),
    }
    store.insert(subscriber)

    const event = assertSubscriberConfirmed({
      type: 'SubscriberConfirmed',
      id: randomUUID(),
      subscriberId: subscriber.id,
      email: subscriber.email,
      confirmedAt: subscriber.createdAt,
    })

    // Privacy: log the opaque id, never the address at info level.
    log.info('subscriber confirmed', { subscriberId: subscriber.id })
    await bus.publish(event)
    return { ok: true, subscriberId: subscriber.id, event }
  } catch (err) {
    if (err instanceof ValidationError || err instanceof DuplicateSubscriberError) {
      return { ok: false, statusCode: err.statusCode, error: err.message }
    }
    log.error('subscribe failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, statusCode: 500, error: 'internal error' }
  }
}
