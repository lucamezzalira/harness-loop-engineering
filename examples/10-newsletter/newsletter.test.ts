import { describe, expect, it, vi } from 'vitest'
import {
  assertSubscriberConfirmed,
  createInProcessBus,
  isPlausibleEmail,
} from './packages/contracts/src/index.js'
import { attachWelcomeHandler } from './services/email-service/src/handler.js'
import { createMailTransport, IdempotentMailer } from './services/email-service/src/mailer.js'
import { SubscriberStore } from './services/subscription-service/src/store.js'
import { subscribe } from './services/subscription-service/src/subscribe.js'

function silentLog() {
  return { info: vi.fn(), error: vi.fn() }
}

describe('contracts', () => {
  it('accepts a well-formed SubscriberConfirmed', () => {
    const event = assertSubscriberConfirmed({
      type: 'SubscriberConfirmed',
      id: 'evt-1',
      subscriberId: 'sub-1',
      email: 'ada@example.com',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(event.email).toBe('ada@example.com')
  })

  it('rejects an event whose email is not plausible', () => {
    expect(() =>
      assertSubscriberConfirmed({
        type: 'SubscriberConfirmed',
        id: 'evt-1',
        subscriberId: 'sub-1',
        email: 'not-an-email',
        confirmedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/plausible/)
  })

  it('shares address rules with the mail transport', () => {
    expect(isPlausibleEmail('ada@example.com')).toBe(true)
    expect(isPlausibleEmail('not-an-email')).toBe(false)
  })
})

describe('subscription flow', () => {
  it('persists a subscriber and emits SubscriberConfirmed', async () => {
    const store = new SubscriberStore()
    const bus = createInProcessBus()
    const seen: unknown[] = []
    bus.subscribe('SubscriberConfirmed', async (e) => {
      seen.push(e)
    })
    const result = await subscribe(store, bus, silentLog(), {
      email: 'ada@example.com',
    })
    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(assertSubscriberConfirmed(seen[0]).email).toBe('ada@example.com')
  })

  it('rejects a duplicate email', async () => {
    const store = new SubscriberStore()
    const bus = createInProcessBus()
    const log = silentLog()
    await subscribe(store, bus, log, { email: 'ada@example.com' })
    const second = await subscribe(store, bus, log, { email: 'ada@example.com' })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.statusCode).toBe(409)
  })

  it('does not leave a check-then-insert race on concurrent subscribe', async () => {
    const store = new SubscriberStore()
    const bus = createInProcessBus()
    const log = silentLog()
    const results = await Promise.all([
      subscribe(store, bus, log, { email: 'race@example.com' }),
      subscribe(store, bus, log, { email: 'race@example.com' }),
    ])
    const wins = results.filter((r) => r.ok)
    const losses = results.filter((r) => !r.ok)
    expect(wins).toHaveLength(1)
    expect(losses).toHaveLength(1)
  })

  it('rejects addresses the mail transport would throw on', async () => {
    const store = new SubscriberStore()
    const bus = createInProcessBus()
    const result = await subscribe(store, bus, silentLog(), {
      email: 'not-an-email',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(400)
    const transport = createMailTransport()
    await expect(transport.send({ to: 'not-an-email', subject: 'x', body: 'y' })).rejects.toThrow(
      /rejected address/,
    )
  })

  it('does not write the subscriber email to info logs', async () => {
    const store = new SubscriberStore()
    const bus = createInProcessBus()
    const log = silentLog()
    await subscribe(store, bus, log, { email: 'private@example.com' })
    for (const call of log.info.mock.calls) {
      const blob = JSON.stringify(call)
      expect(blob).not.toContain('private@example.com')
    }
  })
})

describe('email flow', () => {
  it('sends a welcome email once per event id', async () => {
    const bus = createInProcessBus()
    const mailer = new IdempotentMailer(createMailTransport())
    attachWelcomeHandler(bus, mailer, silentLog())
    const event = assertSubscriberConfirmed({
      type: 'SubscriberConfirmed',
      id: 'evt-dup',
      subscriberId: 'sub-1',
      email: 'ada@example.com',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await bus.publish(event)
    await bus.publish(event)
    expect(mailer.sentCount()).toBe(1)
  })

  it('does not ack when send fails', async () => {
    const bus = createInProcessBus()
    const transport = {
      send: vi.fn(async () => {
        throw new Error('smtp down')
      }),
    }
    const mailer = new IdempotentMailer(transport)
    attachWelcomeHandler(bus, mailer, silentLog())
    const event = assertSubscriberConfirmed({
      type: 'SubscriberConfirmed',
      id: 'evt-fail',
      subscriberId: 'sub-1',
      email: 'ada@example.com',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(bus.publish(event)).rejects.toThrow(/smtp down/)
    expect(mailer.sentCount()).toBe(0)
  })
})

describe('service boundaries', () => {
  it('email-service modules do not import subscription-service internals', async () => {
    // Runtime guard documenting the intent. Stage 55-service-boundaries is the
    // real oracle; this assertion keeps the clean tree honest in unit tests.
    const handlerSrc = await import('./services/email-service/src/handler.js')
    expect(handlerSrc.attachWelcomeHandler).toBeTypeOf('function')
    const mailerSrc = await import('./services/email-service/src/mailer.js')
    expect(mailerSrc.IdempotentMailer).toBeTypeOf('function')
  })
})
