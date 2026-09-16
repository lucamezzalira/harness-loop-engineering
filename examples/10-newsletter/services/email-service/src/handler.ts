import {
  assertSubscriberConfirmed,
  type EventBus,
  type NewsletterEvent,
} from '../../../packages/contracts/src/index.js'
import type { IdempotentMailer } from './mailer.js'

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

/**
 * Consumes SubscriberConfirmed and sends a welcome email.
 * Failures propagate so the bus does not treat the message as acknowledged.
 */
export function attachWelcomeHandler(bus: EventBus, mailer: IdempotentMailer, log: Logger): void {
  bus.subscribe('SubscriberConfirmed', async (event: NewsletterEvent) => {
    const confirmed = assertSubscriberConfirmed(event)
    try {
      await mailer.sendWelcome(confirmed.id, confirmed.email)
      log.info('welcome email sent', { eventId: confirmed.id })
    } catch (err) {
      log.error('welcome email failed', {
        eventId: confirmed.id,
        error: err instanceof Error ? err.message : String(err),
      })
      // Re-throw so the publisher / poller can retry. Acks happen only on success.
      throw err
    }
  })
}
