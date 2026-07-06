import { describe, it, expect } from 'vitest'
import { secretsMatch } from '@/lib/cron-auth'

describe('secretsMatch', () => {
  it('returns true for identical secrets', () => {
    expect(secretsMatch('super-secret-cron-key', 'super-secret-cron-key')).toBe(true)
  })

  it('returns false for a mismatched secret', () => {
    expect(secretsMatch('wrong-secret', 'super-secret-cron-key')).toBe(false)
  })

  it('returns false when the provided secret is a prefix of the expected one', () => {
    expect(secretsMatch('super-secret', 'super-secret-cron-key')).toBe(false)
  })

  it('returns false for an empty provided secret against a non-empty expected one', () => {
    expect(secretsMatch('', 'super-secret-cron-key')).toBe(false)
  })

  it('returns true when both secrets are empty', () => {
    expect(secretsMatch('', '')).toBe(true)
  })

  it('is case sensitive', () => {
    expect(secretsMatch('Super-Secret', 'super-secret')).toBe(false)
  })
})
