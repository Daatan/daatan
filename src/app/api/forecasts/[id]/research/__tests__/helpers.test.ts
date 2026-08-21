import { describe, it, expect } from 'vitest'
import { extractKeyTerms, composeResearchResults } from '../helpers'

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

// ---------------------------------------------------------------------------
// composeResearchResults
// ---------------------------------------------------------------------------

describe('composeResearchResults', () => {
  const article = (id: string) => ({
    title: id, url: `https://example.com/${id}`, snippet: id, source: 'example.com',
  })
  const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => article(`${prefix}-${i}`))
  const caps = { preCreation: 5, total: 20 }

  it('reserves slots for the pre-creation leg when deadline legs would flood the cap (daatan#1515)', () => {
    const result = composeResearchResults(many('primary', 10), many('pre', 6), many('deadline', 15), caps)
    const pre = result.filter(r => r.url.includes('/pre-'))
    expect(pre).toHaveLength(5)
    expect(result).toHaveLength(20)
    // Deadline-targeted fills the remainder rather than being squeezed out entirely
    expect(result.filter(r => r.url.includes('/deadline-'))).toHaveLength(5)
  })

  it('does not spend reserved pre-creation slots on duplicates of primary results', () => {
    const primary = many('primary', 3)
    const pre = [primary[0], primary[1], ...many('pre', 5)]
    const result = composeResearchResults(primary, pre, [], caps)
    expect(result.filter(r => r.url.includes('/pre-'))).toHaveLength(5)
  })

  it('gives unused reservation back to the deadline leg', () => {
    const result = composeResearchResults(many('primary', 4), [], many('deadline', 20), caps)
    expect(result).toHaveLength(20)
    expect(result.filter(r => r.url.includes('/deadline-'))).toHaveLength(16)
  })

  it('dedups across all legs and respects the total cap', () => {
    const shared = article('shared')
    const result = composeResearchResults([shared], [shared], [shared, ...many('deadline', 30)], caps)
    expect(result.filter(r => r.url === shared.url)).toHaveLength(1)
    expect(result).toHaveLength(20)
  })
})
