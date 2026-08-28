import { describe, it, expect } from 'vitest'
import { truncateAtSentence } from '../truncate-text'

describe('truncateAtSentence', () => {
  it('returns the text unchanged when it already fits', () => {
    expect(truncateAtSentence('Short context.', 100)).toEqual({
      preview: 'Short context.',
      isTruncated: false,
    })
  })

  it('keeps whole sentences and stops before exceeding the limit', () => {
    const text = 'First sentence here. Second sentence follows. Third one too.'
    const result = truncateAtSentence(text, 40)
    expect(result.preview).toBe('First sentence here.')
    expect(result.isTruncated).toBe(true)
  })

  it('never cuts mid-word or mid-sentence', () => {
    const text = 'Alpha bravo charlie delta echo foxtrot golf. Hotel india juliet.'
    const result = truncateAtSentence(text, 30)
    expect(result.preview.endsWith('.')).toBe(true)
    expect(text.startsWith(result.preview)).toBe(true)
  })

  it('keeps at least one full sentence even if it alone exceeds maxChars', () => {
    const longSentence = 'This single sentence is deliberately long enough to blow past the cap.'
    const result = truncateAtSentence(longSentence, 20)
    expect(result.preview).toBe(longSentence)
    expect(result.isTruncated).toBe(false)
  })

  it('keeps one full sentence and marks truncated when more sentences follow', () => {
    const text = 'This single sentence is deliberately long enough to blow past the cap. And then a second one.'
    const result = truncateAtSentence(text, 20)
    expect(result.preview).toBe('This single sentence is deliberately long enough to blow past the cap.')
    expect(result.isTruncated).toBe(true)
  })

  it('trims surrounding whitespace before measuring', () => {
    expect(truncateAtSentence('  Padded.  ', 100)).toEqual({ preview: 'Padded.', isTruncated: false })
  })
})
