// Note: humanizeISODates is tested thoroughly in src/lib/llm/__tests__/humanizeISODates.test.ts

import { describe, it, expect } from 'vitest'
import { expressPredictionSchema, getFiveYearsFromNow, normalizeDateBasis } from '@/lib/llm/expressPrediction'
import { SchemaType } from '@google/generative-ai'

describe('expressPredictionSchema', () => {
  // Cast to access object schema properties — the Schema union type is narrow
  const schema = expressPredictionSchema as {
    properties: Record<string, unknown>
    required: string[]
  }

  it('includes outcomeType field', () => {
    expect(schema.properties).toHaveProperty('outcomeType')
    expect(schema.properties.outcomeType).toEqual({
      type: SchemaType.STRING,
      description: expect.stringContaining('BINARY'),
    })
  })

  it('includes options field as array', () => {
    expect(schema.properties).toHaveProperty('options')
    expect(schema.properties.options).toEqual({
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: expect.stringContaining('MULTIPLE_CHOICE'),
    })
  })

  it('requires outcomeType and options in the schema', () => {
    expect(schema.required).toContain('outcomeType')
    expect(schema.required).toContain('options')
  })

  it('still requires all original fields', () => {
    const requiredFields = ['claimText', 'resolveByDatetime', 'detailsText', 'tags', 'resolutionRules']
    for (const field of requiredFields) {
      expect(schema.required).toContain(field)
    }
  })

  it('includes dateBasis field and requires it (#1706)', () => {
    expect(schema.properties).toHaveProperty('dateBasis')
    expect(schema.properties.dateBasis).toEqual({
      type: SchemaType.STRING,
      description: expect.stringContaining('explicit_in_claim'),
    })
    expect(schema.required).toContain('dateBasis')
  })
})

describe('normalizeDateBasis', () => {
  it('passes through a valid enum value unchanged', () => {
    expect(normalizeDateBasis('explicit_in_claim')).toBe('explicit_in_claim')
    expect(normalizeDateBasis('from_sources')).toBe('from_sources')
    expect(normalizeDateBasis('assumed')).toBe('assumed')
  })

  it('falls back to "assumed" when the value is absent', () => {
    expect(normalizeDateBasis(undefined)).toBe('assumed')
  })

  it('falls back to "assumed" for an unrecognized string (fallback provider drift)', () => {
    expect(normalizeDateBasis('guessed')).toBe('assumed')
    expect(normalizeDateBasis('')).toBe('assumed')
  })
})

describe('getFiveYearsFromNow', () => {
  it('returns an ISO date exactly 5 calendar years in the future', () => {
    const now = new Date('2026-04-06T12:00:00Z')
    const { iso } = getFiveYearsFromNow(now)
    expect(iso).toBe('2031-04-06T23:59:59Z')
  })

  it('ISO date ends at 23:59:59Z (deadline-of-day semantics)', () => {
    const { iso } = getFiveYearsFromNow(new Date('2026-01-15T00:00:00Z'))
    expect(iso).toMatch(/T23:59:59Z$/)
  })

  it('human label is a recognisable long date string containing the future year', () => {
    const { human } = getFiveYearsFromNow(new Date('2026-04-06T12:00:00Z'))
    expect(human).toContain('2031')
    // Sanity check: should look like a date, not an ISO string
    expect(human).not.toMatch(/T\d{2}:/)
  })

  it('handles month-end correctly — March 31 + 5 years stays March 31', () => {
    const { iso } = getFiveYearsFromNow(new Date('2026-03-31T00:00:00Z'))
    expect(iso).toMatch(/^2031-03-31/)
  })

  it('handles leap-day input — Feb 29 + 5 years rolls to Mar 1 (no Feb 29 in non-leap year)', () => {
    // 2024 is a leap year; 2029 is not
    const { iso } = getFiveYearsFromNow(new Date('2024-02-29T00:00:00Z'))
    expect(iso).toMatch(/^2029-03-01/)
  })
})
