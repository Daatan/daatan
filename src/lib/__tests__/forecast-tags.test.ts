import { describe, it, expect } from 'vitest'
import { MAX_FORECAST_TAGS, normalizeForecastTags } from '../forecast-tags'
import { createPredictionSchema, updatePredictionSchema } from '../validations/prediction'

describe('normalizeForecastTags (#1787)', () => {
  it('trims and drops empty and non-string entries', () => {
    expect(normalizeForecastTags(['  AI ', '', '   ', null, 42, 'Crypto'])).toEqual(['AI', 'Crypto'])
  })

  it('dedupes case-insensitively and by slug, keeping the first spelling', () => {
    expect(normalizeForecastTags(['Middle East', 'middle east', 'Middle-East', 'AI', 'ai'])).toEqual(['Middle East', 'AI'])
  })

  it('keeps distinct non-Latin tags even though they slugify to empty', () => {
    expect(normalizeForecastTags(['בחירות', 'כלכלה'])).toEqual(['בחירות', 'כלכלה'])
  })

  it('drops tags over 50 characters instead of truncating them', () => {
    expect(normalizeForecastTags(['x'.repeat(51), 'Science'])).toEqual(['Science'])
  })

  it('caps the list at MAX_FORECAST_TAGS', () => {
    expect(MAX_FORECAST_TAGS).toBe(5)
    expect(normalizeForecastTags(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('handles null/undefined', () => {
    expect(normalizeForecastTags(undefined)).toEqual([])
    expect(normalizeForecastTags(null)).toEqual([])
  })
})

describe('forecast schemas normalise tags instead of rejecting (#1787)', () => {
  const base = {
    claimText: 'A testable forecast claim',
    resolveByDatetime: '2027-12-31T23:59:59Z',
    outcomeType: 'BINARY' as const,
  }
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

  it('createPredictionSchema accepts 7 tags and keeps 5', () => {
    expect(createPredictionSchema.parse({ ...base, tags: seven }).tags).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('createPredictionSchema leaves tags undefined when omitted', () => {
    expect(createPredictionSchema.parse(base).tags).toBeUndefined()
  })

  it('createPredictionSchema still rejects a non-array tags value', () => {
    expect(() => createPredictionSchema.parse({ ...base, tags: 'AI' })).toThrow()
  })

  it('updatePredictionSchema caps tags the same way', () => {
    expect(updatePredictionSchema.parse({ tags: seven }).tags).toHaveLength(5)
  })
})
