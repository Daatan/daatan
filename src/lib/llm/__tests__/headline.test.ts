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

  it('returns null when polarity flips', async () => {
    generateContent.mockResolvedValue({ text: 'Ceasefire this year' })
    expect(await generateHeadline('A ceasefire will not be implemented by Dec 31, 2026')).toBeNull()
  })

  it('returns null when too long', async () => {
    generateContent.mockResolvedValue({ text: 'one two three four five six seven eight nine ten' })
    expect(await generateHeadline('Something will happen by 2027')).toBeNull()
  })

  it('returns null on LLM failure', async () => {
    generateContent.mockRejectedValue(new Error('down'))
    expect(await generateHeadline('Something will happen by 2027')).toBeNull()
  })

  it('stores only while the claim is unchanged', async () => {
    generateContent.mockResolvedValue({ text: 'Netanyahu wins' })
    await generateAndStoreHeadline('p1', 'Netanyahu will win the 2026 Israeli election')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', claimText: 'Netanyahu will win the 2026 Israeli election' },
      data: { headline: 'Netanyahu wins' },
    })
  })

  it('stores nothing when generation is rejected', async () => {
    generateContent.mockResolvedValue({ text: 'Ceasefire this year' })
    await generateAndStoreHeadline('p1', 'A ceasefire will not be implemented by Dec 31, 2026')
    expect(updateMany).not.toHaveBeenCalled()
  })
})
