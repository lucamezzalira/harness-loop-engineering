import { isPlausibleEmail } from '../../../packages/contracts/src/index.js'

/**
 * Rejects addresses the mail transport cannot send.
 * The transport throws on anything that fails isPlausibleEmail, so this gate
 * must stay at least as strict.
 */
export function validateSubscribeEmail(email: unknown): string {
  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('email is required')
  }
  const trimmed = email.trim()
  if (!isPlausibleEmail(trimmed)) {
    throw new ValidationError('email is not a valid address')
  }
  return trimmed
}

export class ValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
