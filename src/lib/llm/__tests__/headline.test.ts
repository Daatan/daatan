import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContent = vi.fn()
vi.mock('../index', () => ({ llmService: { generateContent: (...a: unknown[]) => generateContent(...a) } }))
const updateMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { updateMany: (...a: unknown[]) => updateMany(...a) } } }))

import {
  generateHeadline, generateAndStoreHeadline, polarityMatches, HEADLINE_PROMPT,
  HEADLINE_MAX_CHARS, HEADLINE_MAX_WORDS,
} from '../headline'

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

describe('HEADLINE_PROMPT', () => {
  it('asks for the future tense, not present-tense headlinese (#1823)', () => {
    expect(HEADLINE_PROMPT).toMatch(/Future tense/)
    expect(HEADLINE_PROMPT).toContain('Russia will unblock Telegram')
  })
  it('asks for a self-contained headline, as short as possible but as complete as necessary', () => {
    expect(HEADLINE_PROMPT).toContain('as short as possible, but as complete as necessary')
    expect(HEADLINE_PROMPT).toContain('Benny Gantz will withdraw from the race before the elections')
    expect(HEADLINE_PROMPT).toContain('never more than 12 words or 60 characters')
    expect(HEADLINE_PROMPT).not.toMatch(/2 to 6 words/)
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

  it("returns '' when polarity still flips after the one retry", async () => {
    generateContent.mockResolvedValue({ text: 'Ceasefire this year' })
    expect(await generateHeadline('A ceasefire will not be implemented by Dec 31, 2026')).toBe('')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('retries once with a hint when the paraphrase moves the negation (#1831)', async () => {
    generateContent
      .mockResolvedValueOnce({ text: "Next Israeli PM won't serve full term" })
      .mockResolvedValueOnce({ text: 'Next Israeli PM will serve less than full term' })
    expect(await generateHeadline('The next Prime Minister of Israel will serve for less than a full four-year term.'))
      .toBe('Next Israeli PM will serve less than full term')
    const retryPrompt: string = generateContent.mock.calls[1][0].prompt
    expect(retryPrompt).toContain(`Your previous headline "Next Israeli PM won't serve full term" was rejected`)
    expect(retryPrompt.trim().endsWith('Headline:')).toBe(true)
  })

  it('waits past the first-attempt timeout for the retry (#1831)', async () => {
    vi.useFakeTimers()
    try {
      generateContent
        .mockResolvedValueOnce({ text: "Next Israeli PM won't serve full term" })
        .mockImplementationOnce(() => new Promise((r) => setTimeout(() => r({ text: 'Next Israeli PM will serve less than full term' }), 19_000)))
      const pending = generateHeadline('The next Prime Minister of Israel will serve for less than a full four-year term.')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(await pending).toBe('Next Israeli PM will serve less than full term')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry when polarity matches', async () => {
    generateContent.mockResolvedValue({ text: 'Netanyahu will win' })
    await generateHeadline('Netanyahu will win the 2026 Israeli election')
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('keeps a self-contained headline of 10 words (the old 9-word cap would have rejected it)', async () => {
    generateContent.mockResolvedValue({ text: 'Benny Gantz will withdraw from the race before the elections' })
    expect(await generateHeadline('Benny Gantz will withdraw his candidacy before the 2026 elections'))
      .toBe('Benny Gantz will withdraw from the race before the elections')
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('keeps a very short headline when it is clear', async () => {
    generateContent.mockResolvedValue({ text: 'Nvidia will top $5T' })
    expect(await generateHeadline('Nvidia market cap will exceed $5T by June 2027')).toBe('Nvidia will top $5T')
  })

  it("returns '' when still too long after the shorten retry", async () => {
    generateContent.mockResolvedValue({ text: 'one two three four five six seven eight nine ten eleven twelve thirteen' })
    expect(await generateHeadline('Something will happen by 2027')).toBe('')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('retries once with a shorten hint when over the word limit, and keeps the shorter result', async () => {
    generateContent
      .mockResolvedValueOnce({ text: 'one two three four five six seven eight nine ten eleven twelve thirteen' })
      .mockResolvedValueOnce({ text: 'Something will happen by 2027' })
    expect(await generateHeadline('Something will happen by 2027')).toBe('Something will happen by 2027')
    const retryPrompt: string = generateContent.mock.calls[1][0].prompt
    expect(retryPrompt).toContain('is too long (13 words')
    expect(retryPrompt).toContain('keep the subject, the outcome, and any negation, timing or condition')
    expect(retryPrompt.trim().endsWith('Headline:')).toBe(true)
  })

  it('retries when over 60 characters even within 12 words', async () => {
    const long = 'Internationalization Administration Reconfiguration Notwithstanding Extraordinarily'
    expect(long.length).toBeGreaterThan(60)
    generateContent
      .mockResolvedValueOnce({ text: long })
      .mockResolvedValueOnce({ text: 'Something will happen by 2027' })
    expect(await generateHeadline('Something will happen by 2027')).toBe('Something will happen by 2027')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('still rejects a shortened headline that drops the negation', async () => {
    generateContent
      .mockResolvedValueOnce({ text: 'There will be no ceasefire between the two sides in the region before the end of the year' })
      .mockResolvedValueOnce({ text: 'Ceasefire this year' })
    expect(await generateHeadline('A ceasefire will not be implemented by Dec 31, 2026')).toBe('')
  })

  it('stays within the VarChar(80) column and the two-line mobile budget', () => {
    expect(HEADLINE_MAX_CHARS).toBeLessThanOrEqual(60)
    expect(HEADLINE_MAX_WORDS).toBe(12)
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

  it("stores '' when the guard rejects, so it is recorded as rejected", async () => {
    generateContent.mockResolvedValue({ text: 'Ceasefire this year' })
    expect(await generateAndStoreHeadline('p1', 'A ceasefire will not be implemented by Dec 31, 2026')).toBe('rejected')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', claimText: 'A ceasefire will not be implemented by Dec 31, 2026' },
      data: { headline: '' },
    })
  })

  it('stores nothing when the LLM fails', async () => {
    generateContent.mockRejectedValue(new Error('down'))
    expect(await generateAndStoreHeadline('p1', 'Something will happen by 2027')).toBe('failed')
    expect(updateMany).not.toHaveBeenCalled()
  })
})
