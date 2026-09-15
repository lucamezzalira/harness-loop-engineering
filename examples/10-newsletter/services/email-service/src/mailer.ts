import { isPlausibleEmail } from '../../../packages/contracts/src/index.js'

export type MailTransport = {
  send(input: { to: string; subject: string; body: string }): Promise<void>
}

/**
 * Fake transport. Throws when the address is not plausible, matching the
 * contract shared with subscription validation (see D6).
 */
export function createMailTransport(): MailTransport {
  return {
    async send(input) {
      if (!isPlausibleEmail(input.to)) {
        throw new Error(`mail transport rejected address: ${input.to}`)
      }
    },
  }
}

export class IdempotentMailer {
  private readonly sent = new Set<string>()

  constructor(private readonly transport: MailTransport) {}

  async sendWelcome(idempotencyKey: string, to: string): Promise<void> {
    if (this.sent.has(idempotencyKey)) {
      return
    }
    await this.transport.send({
      to,
      subject: 'Welcome to the newsletter',
      body: 'Thanks for confirming your subscription.',
    })
    this.sent.add(idempotencyKey)
  }

  sentCount(): number {
    return this.sent.size
  }
}
