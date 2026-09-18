/** Shared events, DTOs, and the event bus. The only allowed cross-service import. */

export type SubscribeRequest = {
  email: string
}

export type SubscriberConfirmed = {
  type: 'SubscriberConfirmed'
  id: string
  subscriberId: string
  email: string
  confirmedAt: string
}

export type NewsletterEvent = SubscriberConfirmed

export const SubscriberConfirmedSchema = {
  type: 'SubscriberConfirmed',
  required: ['type', 'id', 'subscriberId', 'email', 'confirmedAt'] as const,
}

export function assertSubscriberConfirmed(value: unknown): SubscriberConfirmed {
  if (typeof value !== 'object' || value === null) {
    throw new Error('SubscriberConfirmed must be an object')
  }
  const v = value as Record<string, unknown>
  for (const key of SubscriberConfirmedSchema.required) {
    if (typeof v[key] !== 'string' || v[key] === '') {
      throw new Error(`SubscriberConfirmed.${key} must be a non-empty string`)
    }
  }
  if (v.type !== 'SubscriberConfirmed') {
    throw new Error('SubscriberConfirmed.type mismatch')
  }
  if (!isPlausibleEmail(String(v.email))) {
    throw new Error('SubscriberConfirmed.email is not a plausible address')
  }
  return {
    type: 'SubscriberConfirmed',
    id: String(v.id),
    subscriberId: String(v.subscriberId),
    email: String(v.email),
    confirmedAt: String(v.confirmedAt),
  }
}

/** Shared address shape used by validation and by the mail transport. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export type EventHandler = (event: NewsletterEvent) => Promise<void>

export interface EventBus {
  publish(event: NewsletterEvent): Promise<void>
  subscribe(type: NewsletterEvent['type'], handler: EventHandler): void
  /** Drain pending work. Useful for tests and file-backed polling. */
  flush(): Promise<void>
}

export function createInProcessBus(): EventBus {
  const handlers = new Map<string, EventHandler[]>()
  return {
    async publish(event) {
      const list = handlers.get(event.type) ?? []
      for (const handler of list) {
        await handler(event)
      }
    },
    subscribe(type, handler) {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
    },
    async flush() {
      // In-process publish is already awaited.
    },
  }
}

/**
 * File-backed bus so the two services can run as separate processes.
 * Publishers append JSON lines. Subscribers poll and track offsets.
 */
export function createFileBus(
  filePath: string,
  fs: {
    appendFile(path: string, data: string): Promise<void>
    readFile(path: string): Promise<string>
    access(path: string): Promise<void>
  },
): EventBus {
  const handlers = new Map<string, EventHandler[]>()
  let offset = 0

  async function ensureFile() {
    try {
      await fs.access(filePath)
    } catch {
      await fs.appendFile(filePath, '')
    }
  }

  return {
    async publish(event) {
      await ensureFile()
      await fs.appendFile(filePath, `${JSON.stringify(event)}\n`)
    },
    subscribe(type, handler) {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
    },
    async flush() {
      await ensureFile()
      const raw = await fs.readFile(filePath)
      const chunk = raw.slice(offset)
      if (!chunk) return
      const lines = chunk.split('\n')
      // Keep a trailing partial line unconsumed.
      const complete = chunk.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1)
      const consumed = complete.join('\n')
      if (consumed.length > 0) {
        offset += consumed.length + 1
      }
      for (const line of complete) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as NewsletterEvent
        const list = handlers.get(event.type) ?? []
        for (const handler of list) {
          await handler(event)
        }
      }
    },
  }
}
