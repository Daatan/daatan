import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/moderation', () => ({ checkContent: vi.fn(async () => ({ isOffensive: false, reason: '' })) }))
vi.mock('../../utils/scraper', () => ({ fetchUrlContent: vi.fn() }))
vi.mock('../../services/oracleSearch', () => ({ oracleSearch: vi.fn(async () => []) }))
vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('../searchQuery', () => ({ buildSearchQuery: vi.fn(async (t: string) => t) }))
vi.mock('../bedrock-prompts', () => ({
  getPromptTemplate: vi.fn(async () => 'TEMPLATE'),
  fillPrompt: vi.fn(() => 'PROMPT'),
}))
vi.mock('../../services/translation', () => ({ localizeForecastForAuthor: vi.fn(async () => null) }))

import { guessChances, clampGuessedProbability, GUESS_PERCENT_MIN, GUESS_PERCENT_MAX } from '../expressPrediction'
import { llmService } from '../index'

const guess = async (probability: unknown) => {
  vi.mocked(llmService.generateContent).mockResolvedValueOnce({
    text: JSON.stringify({ probability, reasoning: 'r' }),
  } as never)
  return guessChances('claim', '', [])
}

describe('guessChances clamp (daatan#2151)', () => {
  it('never returns a literal 100 or 0', async () => {
    expect((await guess(100)).probability).toBe(97)
    expect((await guess(0)).probability).toBe(3)
  })

  it('rounds and keeps in-range values', async () => {
    expect((await guess(66.4)).probability).toBe(66)
    expect((await guess(97)).probability).toBe(97)
    expect((await guess(98.6)).probability).toBe(97)
  })

  it('passes abstain (null) through and keeps the reasoning', async () => {
    const r = await guess(null)
    expect(r.probability).toBeNull()
    expect(r.reasoning).toBe('r')
  })

  it('matches the settlement pin bounds (temporal-clock PIN_LOW/PIN_HIGH)', async () => {
    const { PIN_LOW, PIN_HIGH } = await vi.importActual<typeof import('../../services/temporal-clock')>('../../services/temporal-clock')
    expect([GUESS_PERCENT_MIN, GUESS_PERCENT_MAX]).toEqual([PIN_LOW, PIN_HIGH])
  })

  it('treats non-finite as abstain', () => {
    expect(clampGuessedProbability(Number.NaN)).toBeNull()
    expect(clampGuessedProbability(undefined)).toBeNull()
  })
})
