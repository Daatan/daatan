import { describe, it, expect } from 'vitest'
import {
  parseAllowedDomains,
  isEmailDomainAllowed,
  isOpenSignupEnabled,
} from '@/lib/auth/access'

describe('parseAllowedDomains', () => {
  it('returns an empty set when unset', () => {
    expect(parseAllowedDomains(undefined).size).toBe(0)
    expect(parseAllowedDomains('').size).toBe(0)
  })

  it('splits on commas, whitespace and newlines; lowercases; strips leading @', () => {
    const d = parseAllowedDomains('Acme.com, @acme.co.uk\n  EXAMPLE.org ')
    expect([...d].sort()).toEqual(['acme.co.uk', 'acme.com', 'example.org'])
  })
})

describe('isEmailDomainAllowed', () => {
  it('allows anything when the list is empty (no restriction)', () => {
    expect(isEmailDomainAllowed('anyone@whatever.io', new Set())).toBe(true)
    expect(isEmailDomainAllowed(null, new Set())).toBe(true)
  })

  it('matches the domain case-insensitively and exactly', () => {
    const d = parseAllowedDomains('acme.com')
    expect(isEmailDomainAllowed('jane@acme.com', d)).toBe(true)
    expect(isEmailDomainAllowed('jane@ACME.com', d)).toBe(true)
    expect(isEmailDomainAllowed('jane@evil.com', d)).toBe(false)
  })

  it('does not match subdomains (no wildcards)', () => {
    const d = parseAllowedDomains('acme.com')
    expect(isEmailDomainAllowed('jane@sub.acme.com', d)).toBe(false)
  })

  it('rejects a missing or malformed email when a list is configured', () => {
    const d = parseAllowedDomains('acme.com')
    expect(isEmailDomainAllowed(null, d)).toBe(false)
    expect(isEmailDomainAllowed('not-an-email', d)).toBe(false)
  })
})

describe('isOpenSignupEnabled', () => {
  it('is always open for the SaaS edition regardless of the flag', () => {
    expect(isOpenSignupEnabled('saas', undefined)).toBe(true)
    expect(isOpenSignupEnabled('saas', 'false')).toBe(true)
  })

  it('treats an unset edition as SaaS (open) — the test/skip-validation case', () => {
    expect(isOpenSignupEnabled(undefined, undefined)).toBe(true)
  })

  it('is closed by default for self_hosted and opens only on explicit true', () => {
    expect(isOpenSignupEnabled('self_hosted', undefined)).toBe(false)
    expect(isOpenSignupEnabled('self_hosted', 'false')).toBe(false)
    expect(isOpenSignupEnabled('self_hosted', 'true')).toBe(true)
  })
})
