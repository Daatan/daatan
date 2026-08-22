import { describe, it, expect, vi, beforeEach } from 'vitest'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() }),
}))

import { auditResolveByDatetime, auditClaimDeadlineMismatch } from '../deadline-normalisation'

beforeEach(() => warn.mockClear())

describe('auditResolveByDatetime', () => {
  it('is silent on a conventional 23:59:59.999Z deadline', () => {
    expect(auditResolveByDatetime('create', new Date('2027-12-31T23:59:59.999Z'))).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns, without rewriting, on a local-end-of-day deadline converted at UTC+2', () => {
    const stored = new Date('2027-01-15T21:59:59.000Z')
    expect(auditResolveByDatetime('update', stored, { predictionId: 'p1' })).toBe(true)
    expect(stored.toISOString()).toBe('2027-01-15T21:59:59.000Z')
    expect(warn).toHaveBeenCalledTimes(1)
    const [fields, msg] = warn.mock.calls[0]
    expect(fields).toMatchObject({
      predictionId: 'p1',
      path: 'update',
      stored: '2027-01-15T21:59:59.000Z',
      normalised: '2027-01-15T23:59:59.999Z',
      deltaHours: 2,
    })
    expect(msg).toMatch(/log-only/)
  })

  it('flags a midnight deadline that cuts off the final day', () => {
    expect(auditResolveByDatetime('bot-create', new Date('2027-06-02T00:00:00Z'))).toBe(true)
    expect(warn.mock.calls[0][0].normalised).toBe('2027-06-02T23:59:59.999Z')
  })

  it('ignores invalid dates', () => {
    expect(auditResolveByDatetime('create', new Date('nope'))).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('auditClaimDeadlineMismatch', () => {
  it('is silent when the claim has no explicit date, or agrees with resolveByDatetime', () => {
    expect(auditClaimDeadlineMismatch('Candidate X will win the election.', new Date('2026-12-31T23:59:59Z'))).toBe(false)
    expect(auditClaimDeadlineMismatch('Must happen by 31 August 2026.', new Date('2026-08-31T23:59:59Z'))).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns, without blocking, on a claim/deadline mismatch (daatan#1546)', () => {
    const claimText = 'Somaliland will be internationally recognized by the end of 2027.'
    const resolveByDatetime = new Date('2028-01-01T22:59:59.999Z')
    expect(auditClaimDeadlineMismatch(claimText, resolveByDatetime, { predictionId: 'p1' })).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const [fields, msg] = warn.mock.calls[0]
    expect(fields).toMatchObject({
      predictionId: 'p1',
      path: 'update',
      resolveByDatetime: '2028-01-01T22:59:59.999Z',
    })
    expect(msg).toMatch(/log-only/)
  })
})
