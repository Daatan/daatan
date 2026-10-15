import { describe, it, expect } from 'vitest'
import {
  MIN_RESOLUTION_RULES_LENGTH,
  createPredictionSchema,
  updatePredictionSchema,
} from '../validations/prediction'

// #1873: two ACTIVE prod rows carried "official US position" and "foxnews report" as
// their only resolution criterion, which passed the old 10-character floor.
describe('resolutionRules floor (#1873)', () => {
  const base = {
    claimText: 'The US will officially recognise Somaliland by the end of 2027',
    resolveByDatetime: '2027-12-31T23:59:59Z',
    outcomeType: 'BINARY' as const,
  }
  const real =
    'Resolves YES if the US government formally recognises Somaliland as an independent state before 2028.'

  it('rejects the two junk criteria seen in prod on create', () => {
    for (const resolutionRules of ['official US position', 'foxnews report']) {
      expect(createPredictionSchema.safeParse({ ...base, resolutionRules }).success).toBe(false)
    }
  })

  it('rejects padding with whitespace', () => {
    const padded = `   foxnews report${' '.repeat(40)}`
    expect(createPredictionSchema.safeParse({ ...base, resolutionRules: padded }).success).toBe(false)
  })

  it('accepts a real criterion and a draft without rules', () => {
    expect(createPredictionSchema.safeParse({ ...base, resolutionRules: real }).success).toBe(true)
    expect(createPredictionSchema.safeParse(base).success).toBe(true)
  })

  it('applies the same floor on update, but still allows clearing with null', () => {
    expect(updatePredictionSchema.safeParse({ resolutionRules: 'foxnews report' }).success).toBe(false)
    expect(updatePredictionSchema.safeParse({ resolutionRules: real }).success).toBe(true)
    expect(updatePredictionSchema.safeParse({ resolutionRules: null }).success).toBe(true)
    expect(updatePredictionSchema.safeParse({}).success).toBe(true)
  })

  it('keeps short but real criteria in other scripts above the floor', () => {
    const short = 'Resolves YES if FIDE lists 3 Israelis.'
    expect(short.length).toBeGreaterThanOrEqual(MIN_RESOLUTION_RULES_LENGTH)
    expect(createPredictionSchema.safeParse({ ...base, resolutionRules: short }).success).toBe(true)
  })
})
