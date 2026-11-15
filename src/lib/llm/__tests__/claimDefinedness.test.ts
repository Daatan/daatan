import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))

import { authorLanguageName, checkClaimDefinedness, definednessBlocks, DEFINEDNESS_BLOCKS_PUBLISH } from '../claimDefinedness'
import { llmService } from '../index'

const CLAIM = 'Likud will win the next Knesset election.'
const RULES = 'Resolves YES if Likud wins the most seats in the official final results.'
const OPTIONS = ['Likud will win the most seats in the next Knesset election.', 'Likud will lead the next government.']

const reply = (o: Record<string, unknown>) => ({
  text: JSON.stringify({ splitOutcome: '', splitChance: 0, readerShare: 0, fault: 'none', term: '', question: '', options: [], ...o }),
}) as never
const twoReadings = { fault: 'two_readings', splitOutcome: 'Likud gets the most seats; Bennett forms the government.', splitChance: 60, readerShare: 55, term: 'win', question: 'Most seats, or forming the government?', options: OPTIONS }

describe('checkClaimDefinedness (#2166)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes a well-defined claim', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(reply({}))
    const out = await checkClaimDefinedness(CLAIM, RULES)
    expect(out.verdict).toBe('ok')
    expect(vi.mocked(llmService.generateContent).mock.calls[0][0]).toMatchObject({ stage: 'claim_definedness', temperature: 0 })
  })

  it('calls a common second reading with a real split unclear, with the question and options', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(reply(twoReadings))
    const out = await checkClaimDefinedness(CLAIM, RULES, 'הליכוד ינצח בבחירות')
    expect(out).toMatchObject({ verdict: 'unclear', fault: 'two_readings', term: 'win', options: OPTIONS, enforced: DEFINEDNESS_BLOCKS_PUBLISH })
    expect(vi.mocked(llmService.generateContent).mock.calls[0][0].prompt).toContain('Write question and options in Hebrew.')
  })

  it('lets a split that is unlikely or a reading that is rare through', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(reply({ ...twoReadings, splitChance: 10 }))
    expect((await checkClaimDefinedness(CLAIM, RULES)).verdict).toBe('ok')
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(reply({ ...twoReadings, readerShare: 20 }))
    expect((await checkClaimDefinedness(CLAIM, RULES)).verdict).toBe('ok')
  })

  it('calls a literal rules conflict unclear whatever its chance, and an interpretive one ok', () => {
    const conflict = { fault: 'rules_conflict', splitChance: 1, readerShare: 100, options: OPTIONS }
    expect(definednessBlocks(conflict)).toBe(true)
    expect(definednessBlocks({ ...conflict, readerShare: 80 })).toBe(false)
  })

  it('never blocks without two options to pick from', () => {
    expect(definednessBlocks({ ...twoReadings, options: [OPTIONS[0]] })).toBe(false)
  })

  it('fails open when the call fails', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValueOnce(new Error('timeout'))
    expect(await checkClaimDefinedness(CLAIM, RULES)).toMatchObject({ verdict: 'error', enforced: false })
  })

  it('skips the call when there are no rules', async () => {
    expect((await checkClaimDefinedness(CLAIM, '  ')).verdict).toBe('error')
    expect(llmService.generateContent).not.toHaveBeenCalled()
  })
})

describe('authorLanguageName', () => {
  it('names the script the author typed in, English for Latin', () => {
    expect(authorLanguageName('הליכוד ינצח בבחירות')).toBe('Hebrew')
    expect(authorLanguageName('Партия победит')).toBe('Russian')
    expect(authorLanguageName('Likud will win')).toBe('English')
  })
})
