import { describe, it, expect } from 'vitest'
import { parseAdminEmails, resolveAdminRole } from '@/lib/auth/oidc'

describe('parseAdminEmails', () => {
  it('returns an empty set for undefined/empty', () => {
    expect(parseAdminEmails(undefined).size).toBe(0)
    expect(parseAdminEmails('').size).toBe(0)
  })

  it('splits on commas, spaces, and newlines and lowercases', () => {
    const set = parseAdminEmails('Admin@Acme.com, ops@acme.com\n  ceo@ACME.com')
    expect([...set].sort()).toEqual(['admin@acme.com', 'ceo@acme.com', 'ops@acme.com'])
  })

  it('drops empty fragments from stray separators', () => {
    expect(parseAdminEmails(' , ,a@x.com,').size).toBe(1)
  })
})

describe('resolveAdminRole', () => {
  const admins = parseAdminEmails('admin@acme.com')

  it('promotes a listed email (case-insensitive)', () => {
    expect(resolveAdminRole('Admin@Acme.com', admins)).toBe('ADMIN')
  })

  it('returns null for an unlisted email', () => {
    expect(resolveAdminRole('user@acme.com', admins)).toBeNull()
  })

  it('returns null for missing email or empty list', () => {
    expect(resolveAdminRole(undefined, admins)).toBeNull()
    expect(resolveAdminRole('admin@acme.com', new Set())).toBeNull()
  })
})
