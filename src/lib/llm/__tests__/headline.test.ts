import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContent = vi.fn()
vi.mock('../index', () => ({ llmService: { generateContent: (...a: unknown[]) => generateContent(...a) } }))
const updateMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { updateMany: (...a: unknown[]) => updateMany(...a) } } }))

import { generateHeadline, generateAndStoreHeadline, polarityMatches } from '../headline'

describe('polarityMatches', () => {
  it('accepts matching polarity', () => {
    expect(polarityMatches('Netanyahu will win the 2026 election', 'Netanyahu wins')).toBe(true)
    expect(polarityMatches('A ceasefire will not be implemented by Dec 31, 2026', 'No ceasefire this year')).toBe(true)
  })
  it('rejects a dropped negation (#1802 class)', () => {
    expect(polarityMatches('A ceasefire will not be implemented by Dec 31, 2026', 'Ceasefire this year')).toBe(false)
  })
  it('rejects an added negation', () => {
    expect(polarityMatches('Bitcoin will reach $200k by 2027', "Bitcoin won't hit $200k")).toBe(false)
  })
  it('treats "misses" and "zero" as negation', () => {
    expect(polarityMatches('Am Yisrael will not pass the electoral threshold', 'Am Yisrael misses threshold')).toBe(true)
    expect(polarityMatches('Zero rockets will be fired towards Israel by March 8, 2026', 'No rocket fire on Israel')).toBe(true)
  })
  it('skips questions', () => {
    expect(polarityMatches('Who will win the 2028 US presidential election?', 'Next US president')).toBe(true)
  })
})

describe('generateHeadline', () => {
  beforeEach(() => { generateContent.mockReset(); updateMany.mockReset() })

  it('cleans quotes, prefix and trailing period', async () => {
    generateContent.mockResolvedValue({ text: 'Headline: "Netanyahu wins."\nextra' })
    expect(await generateHeadline('Netanyahu will win the 2026 Israeli election')).toBe('Netanyahu wins')
  })

  it('keeps the bot emoji marker and strips it from the prompt', async () => {
    generateContent.mockResolvedValue({ text: 'Nvidia tops $5T' })
    expect(await generateHeadline('🤖 Nvidia market cap will exceed $5T by June 2027')).toBe('🤖 Nvidia tops $5T')
    expect(generateContent.mock.calls[0][0].prompt).not.toContain('🤖')
    expect(generateContent.mock.calls[0][0].stage).toBe('headline')
  })

  it("returns '' (rejected, not retried) when polarity flips", async () => {
    generateContent.mockResolvedValue({ text: 'Ceasefire this year' })
    expect(await generateHeadline('A ceasefire will not be implemented by Dec 31, 2026')).toBe('')
  })

  it("returns '' when too long", async () => {
    generateContent.mockResolvedValue({ text: 'one two three four five six seven eight nine ten' })
    expect(await generateHeadline('Something will happen by 2027')).toBe('')
  })

  it('returns null on LLM failure', async () => {
    generateContent.mockRejectedValue(new Error('down'))
    expect(await generateHeadline('Something will happen by 2027')).toBeNull()
  })

  it('stores only while the claim is unchanged', async () => {
    generateContent.mockResolvedValue({ text: 'Netanyahu wins' })
    expect(await generateAndStoreHeadline('p1', 'Netanyahu will win the 2026 Israeli election')).toBe('stored')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', claimText: 'Netanyahu will win the 2026 Israeli election' },
      data: { headline: 'Netanyahu wins' },
    })
  })

  it("stores '' when the guard rejects, so the backfill doesn't retry it", async () => {
    generateContent.mockResolvedValue({ text: 'Ceasefire this year' })
    expect(await generateAndStoreHeadline('p1', 'A ceasefire will not be implemented by Dec 31, 2026')).toBe('rejected')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', claimText: 'A ceasefire will not be implemented by Dec 31, 2026' },
      data: { headline: '' },
    })
  })

  it('stores nothing when the LLM fails, so the backfill retries it', async () => {
    generateContent.mockRejectedValue(new Error('down'))
    expect(await generateAndStoreHeadline('p1', 'Something will happen by 2027')).toBe('failed')
    expect(updateMany).not.toHaveBeenCalled()
  })
})
