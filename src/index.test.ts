import { describe, expect, it } from 'vitest'
import { identity } from './index.js'

describe('identity', () => {
  it('returns the value', () => {
    expect(identity(1)).toBe(1)
  })
})
