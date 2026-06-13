import { describe, it, expect } from 'vitest'
import { isLocalDuplicate, LOCAL_DEDUP_THRESHOLD } from '@/lib/services/bots/dedup'

describe('isLocalDuplicate', () => {
  it('returns false when there are no existing titles', () => {
    expect(isLocalDuplicate('Bitcoin hits a new record high', [])).toBe(false)
  })

  it('flags a near-identical title as a duplicate', () => {
    const existing = ['Bitcoin price hits a new record high today']
    expect(isLocalDuplicate('Bitcoin price hits record high', existing)).toBe(true)
  })

  it('does not flag a title that only shares a single keyword', () => {
    const existing = ['France election campaign begins next month']
    expect(isLocalDuplicate('United States election results announced', existing)).toBe(false)
  })

  it('matches against any entry in the list, not just the first', () => {
    const existing = [
      'Completely unrelated story about cooking recipes',
      'OpenAI releases a new language model called gpt',
    ]
    expect(isLocalDuplicate('OpenAI releases new gpt language model', existing)).toBe(true)
  })

  it('returns false for a title with no significant keywords', () => {
    expect(isLocalDuplicate('the a an is are', ['the a an is are too'])).toBe(false)
  })

  it('ignores the 🤖 prefix and other punctuation (keyword-based)', () => {
    const existing = ['Ethereum upgrade ships in the next quarter']
    expect(isLocalDuplicate('🤖 Ethereum upgrade ships next quarter!', existing)).toBe(true)
  })

  it('respects a custom threshold', () => {
    const existing = ['Apple unveils a brand new silicon chip design']
    // Partial overlap: passes a lenient threshold, fails a strict one.
    expect(isLocalDuplicate('Apple silicon chip', existing, 0.2)).toBe(true)
    expect(isLocalDuplicate('Apple silicon chip', existing, 0.95)).toBe(false)
  })

  it('exports a sensible default threshold', () => {
    expect(LOCAL_DEDUP_THRESHOLD).toBeGreaterThan(0)
    expect(LOCAL_DEDUP_THRESHOLD).toBeLessThanOrEqual(1)
  })
})
