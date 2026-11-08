import { describe, it, expect } from 'vitest'
import { acceptsEvidence, evidenceEligibleWhere, PENDING_EVIDENCE_GRACE_DAYS } from '../evidence-eligibility'

const NOW = new Date('2026-11-08T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

describe('evidence eligibility (daatan#2122)', () => {
  it('accepts ACTIVE regardless of deadline', () => {
    expect(acceptsEvidence({ status: 'ACTIVE', resolveByDatetime: daysAgo(400) }, NOW)).toBe(true)
  })

  it('accepts PENDING inside the grace period and rejects it after', () => {
    expect(acceptsEvidence({ status: 'PENDING', resolveByDatetime: daysAgo(12) }, NOW)).toBe(true)
    expect(acceptsEvidence({ status: 'PENDING', resolveByDatetime: daysAgo(PENDING_EVIDENCE_GRACE_DAYS) }, NOW)).toBe(true)
    expect(acceptsEvidence({ status: 'PENDING', resolveByDatetime: daysAgo(PENDING_EVIDENCE_GRACE_DAYS + 1) }, NOW)).toBe(false)
  })

  it('rejects every other status', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE']) {
      expect(acceptsEvidence({ status, resolveByDatetime: NOW }, NOW)).toBe(false)
    }
  })

  it('the Prisma filter uses the same cutoff as the row check', () => {
    const where = evidenceEligibleWhere(NOW) as { OR: Array<{ status: string; resolveByDatetime?: { gte: Date } }> }
    expect(where.OR[0]).toEqual({ status: 'ACTIVE' })
    expect(where.OR[1].status).toBe('PENDING')
    expect(where.OR[1].resolveByDatetime!.gte).toEqual(daysAgo(PENDING_EVIDENCE_GRACE_DAYS))
  })
})
