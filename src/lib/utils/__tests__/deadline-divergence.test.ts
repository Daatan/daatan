import { describe, it, expect } from 'vitest'
import { isDeadlineDivergent, DEADLINE_AGREEMENT_TOLERANCE_MS } from '../deadline-divergence'

const NOW = new Date('2026-08-08T00:00:00Z')

describe('isDeadlineDivergent', () => {
  it('is false when the dates agree exactly', () => {
    const d = new Date('2026-12-31T00:00:00Z')
    expect(isDeadlineDivergent(d, d, NOW)).toBe(false)
  })

  it('is false at exactly the tolerance boundary', () => {
    const claim = new Date('2026-12-31T00:00:00Z')
    const resolve = new Date(claim.getTime() + DEADLINE_AGREEMENT_TOLERANCE_MS)
    expect(isDeadlineDivergent(claim, resolve, NOW)).toBe(false)
  })

  it('is true just past the tolerance boundary', () => {
    const claim = new Date('2026-12-31T00:00:00Z')
    const resolve = new Date(claim.getTime() + DEADLINE_AGREEMENT_TOLERANCE_MS + 1)
    expect(isDeadlineDivergent(claim, resolve, NOW)).toBe(true)
  })

  it('is true for the incident shape: claim says 2025, resolveBy is 2027', () => {
    const claim = new Date('2025-12-31T00:00:00Z')
    const resolve = new Date('2027-10-10T00:00:00Z')
    expect(isDeadlineDivergent(claim, resolve, NOW)).toBe(true)
  })

  it('is symmetric in which date is later', () => {
    const a = new Date('2026-01-01T00:00:00Z')
    const b = new Date('2027-01-01T00:00:00Z')
    expect(isDeadlineDivergent(a, b, NOW)).toBe(isDeadlineDivergent(b, a, NOW))
  })

  it('is false once both dates are already in the past, however far apart', () => {
    const claim = new Date('2020-01-01T00:00:00Z')
    const resolve = new Date('2022-01-01T00:00:00Z')
    expect(isDeadlineDivergent(claim, resolve, NOW)).toBe(false)
  })

  it('is true when only one date has passed', () => {
    const claim = new Date('2020-01-01T00:00:00Z') // passed
    const resolve = new Date('2027-01-01T00:00:00Z') // still future
    expect(isDeadlineDivergent(claim, resolve, NOW)).toBe(true)
  })
})
