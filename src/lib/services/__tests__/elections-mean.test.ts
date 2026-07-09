import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { meanToProbability } from '@/lib/services/elections'

describe('meanToProbability', () => {
  it('passes percent-scale means through, rounded', () => {
    expect(meanToProbability(64)).toBe(64)
    expect(meanToProbability(32.9)).toBe(33)
    expect(meanToProbability(54.0)).toBe(54)
  })

  it('does not stance-convert small percent values (pre-2026-07-08 regression)', () => {
    // The old (mean+1)/2*100 conversion turned a 0.6% forecast into 50%.
    expect(meanToProbability(0.6)).toBe(1)
    expect(meanToProbability(1)).toBe(1)
    expect(meanToProbability(0)).toBe(0)
  })

  it('clamps out-of-range values from pre-normalization backups', () => {
    expect(meanToProbability(-0.4)).toBe(0)
    expect(meanToProbability(3250)).toBe(100)
  })

  it('returns null for missing or non-finite input', () => {
    expect(meanToProbability(null)).toBeNull()
    expect(meanToProbability(undefined)).toBeNull()
    expect(meanToProbability(NaN)).toBeNull()
  })
})
