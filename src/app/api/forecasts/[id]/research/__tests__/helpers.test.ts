import { describe, it, expect } from 'vitest'
import { extractKeyTerms } from '../helpers'

// ---------------------------------------------------------------------------
// extractKeyTerms
// ---------------------------------------------------------------------------

describe('extractKeyTerms', () => {
  const resolveDate = new Date('2026-02-24')

  it('removes common stopwords and future-tense helpers', () => {
    const result = extractKeyTerms(
      'The Israeli Shekel will strengthen against the US Dollar by the end of February 24, 2026',
      resolveDate,
    )
    // Should not contain stopwords
    expect(result.toLowerCase()).not.toMatch(/\bwill\b/)
    expect(result.toLowerCase()).not.toMatch(/\bthe\b/)
    expect(result.toLowerCase()).not.toMatch(/\bby\b/)
    expect(result.toLowerCase()).not.toMatch(/\bagainst\b/)
    // Should contain key entities
    expect(result).toMatch(/Israeli/i)
    expect(result).toMatch(/Shekel/i)
    expect(result).toMatch(/Dollar/i)
  })

  it('appends the resolution year when not already present', () => {
    const result = extractKeyTerms('Bitcoin price milestone', resolveDate)
    expect(result).toContain('2026')
  })

  it('does not duplicate the year when the claim already contains it', () => {
    const result = extractKeyTerms('Bitcoin reaches 100k in 2026', resolveDate)
    const matches = result.match(/2026/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('removes punctuation from the claim text', () => {
    const result = extractKeyTerms("The S&P 500 won't fall by 10%, right?", resolveDate)
    expect(result).not.toContain('?')
    expect(result).not.toContain(',')
  })

  it('filters out very short words (≤2 chars)', () => {
    const result = extractKeyTerms('AI is a big deal in tech', resolveDate)
    const words = result.split(' ')
    // "AI" (2 chars) should be filtered
    expect(words.every(w => w.length > 2)).toBe(true)
  })
})
