export type Subscriber = {
  id: string
  email: string
  createdAt: string
}

/**
 * In-memory subscriber store with a unique email constraint.
 * insert() is atomic relative to hasEmail() for a single process: the email
 * index is updated before the function returns, so a second insert of the same
 * email throws rather than racing through a check-then-act gap.
 */
export class SubscriberStore {
  private readonly byId = new Map<string, Subscriber>()
  private readonly emails = new Set<string>()

  hasEmail(email: string): boolean {
    return this.emails.has(email.toLowerCase())
  }

  insert(subscriber: Subscriber): void {
    const key = subscriber.email.toLowerCase()
    if (this.emails.has(key)) {
      throw new DuplicateSubscriberError(subscriber.email)
    }
    this.emails.add(key)
    this.byId.set(subscriber.id, subscriber)
  }

  get(id: string): Subscriber | undefined {
    return this.byId.get(id)
  }

  /** Internal lookup used by this service only. Do not import from email-service. */
  findByEmail(email: string): Subscriber | undefined {
    const key = email.toLowerCase()
    for (const sub of this.byId.values()) {
      if (sub.email.toLowerCase() === key) return sub
    }
    return undefined
  }
}

export class DuplicateSubscriberError extends Error {
  readonly statusCode = 409
  constructor(email: string) {
    super(`subscriber already exists for ${email}`)
    this.name = 'DuplicateSubscriberError'
  }
}
