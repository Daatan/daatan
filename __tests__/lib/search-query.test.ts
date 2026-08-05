import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }))

vi.mock('@/lib/llm', () => ({
  llmService: { generateContent: (...args: unknown[]) => mockGenerateContent(...args) },
}))

import { buildSearchQuery, cleanClaimForSearch } from '@/lib/llm/searchQuery'

describe('cleanClaimForSearch', () => {
  it('strips a leading emoji prefix', () => {
    expect(cleanClaimForSearch('🤖 EU will admit two members')).toBe('EU will admit two members')
  })

  it('takes the segment before a title separator', () => {
    expect(cleanClaimForSearch('EU enlargement | extra title')).toBe('EU enlargement')
  })

  it('trims whitespace', () => {
    expect(cleanClaimForSearch('  hello world  ')).toBe('hello world')
  })
})

describe('buildSearchQuery', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('returns the LLM-extracted query on success', async () => {
    mockGenerateContent.mockResolvedValue({ text: '  "EU enlargement accession"  ' })
    const q = await buildSearchQuery('The EU will admit at least two new member states by 2028')
    expect(q).toBe('EU enlargement accession') // quotes + whitespace stripped
  })

  it('falls back to the cleaned claim when extraction throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('LLM down'))
    const q = await buildSearchQuery('🤖 Bitcoin will reach $100k | tag')
    expect(q).toBe('Bitcoin will reach $100k')
  })

  it('falls back to the cleaned claim when extraction returns empty', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' })
    const q = await buildSearchQuery('Some claim text')
    expect(q).toBe('Some claim text')
  })

  // Fake timers below: these race a real setTimeout against the budget, so on the real
  // clock they would cost the suite the whole budget in wall time — and a mock resolving
  // AT the budget is a coin flip between two equal timers, not a test.
  describe('timeout budget (daatan#1225)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const slow = (ms: number, text: string) =>
      new Promise(resolve => setTimeout(() => resolve({ text }), ms))

    it('keeps a 3.8s extraction — the exact latency that fell back in prod', async () => {
      // The incident: Gemini took 3.8s against the old 2s budget, so search ran on the raw
      // claim sentence, retrieved 7 off-topic Putin articles, and the Oracle abstained —
      // the analyze run published "Insufficient evidence" for ~18 minutes.
      mockGenerateContent.mockImplementation(() => slow(3_800, 'Putin illness health reports'))

      const q = buildSearchQuery("Vladimir Putin's illness will be reported by December 31, 2026.")
      await vi.advanceTimersByTimeAsync(4_000)

      expect(await q).toBe('Putin illness health reports')
    })

    it('still falls back past the raised budget — a hung provider must never block search', async () => {
      mockGenerateContent.mockImplementation(() => slow(20_000, 'too late'))

      const q = buildSearchQuery('Slow claim')
      await vi.advanceTimersByTimeAsync(6_000)

      expect(await q).toBe('Slow claim')
    })
  })
})
