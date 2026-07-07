import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/moderation', () => ({ checkContent: vi.fn() }))
vi.mock('../../utils/scraper', () => ({ fetchUrlContent: vi.fn() }))
vi.mock('../../services/oracleSearch', () => ({ oracleSearch: vi.fn() }))
vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('../searchQuery', () => ({ buildSearchQuery: vi.fn(async (t: string) => t) }))
vi.mock('../bedrock-prompts', () => ({
  getPromptTemplate: vi.fn(async () => 'TEMPLATE'),
  fillPrompt: vi.fn(() => 'PROMPT'),
}))
vi.mock('../../services/translation', () => ({ localizeForecastForAuthor: vi.fn(async () => null) }))

import { generateExpressPrediction } from '../expressPrediction'
import { checkContent } from '../../services/moderation'
import { fetchUrlContent } from '../../utils/scraper'
import { oracleSearch } from '../../services/oracleSearch'
import { llmService } from '../index'

const PREDICTION = {
  claimText: 'A testable claim',
  resolveByDatetime: '2026-11-03T23:59:59Z',
  detailsText: 'Context.',
  tags: ['Politics'],
  resolutionRules: 'Resolved by official results.',
  outcomeType: 'BINARY',
  options: [],
  probabilitySuggestion: 50,
  probabilityReasoning: 'Reasoning.',
  relevantArticleIndices: [1],
}

describe('generateExpressPrediction — moderation gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(llmService.generateContent).mockImplementation(
      async ({ schema }: { schema?: unknown }) =>
        schema ? { text: JSON.stringify(PREDICTION) } : { text: 'topic' } as never,
    )
  })

  it('skips content moderation for a bare URL input (the article-import path)', async () => {
    // Even if the moderator would flag it, a URL must not be blocked here —
    // this is the regression that made Andrej's first attempt fail as "spam".
    // The scrape returns nothing and no related articles are found, yet the
    // user's URL is still honored as the anchor (never dropped for a search hit).
    vi.mocked(checkContent).mockResolvedValue({ isOffensive: true, reason: 'bare URL spam' })
    vi.mocked(fetchUrlContent).mockResolvedValue('')
    vi.mocked(oracleSearch).mockResolvedValue([])

    const result = await generateExpressPrediction('https://news.walla.co.il/item/3845858')

    expect(result.newsAnchor?.url).toBe('https://news.walla.co.il/item/3845858')
    expect(checkContent).not.toHaveBeenCalled()
  })

  it('still moderates free-text input and blocks offensive content', async () => {
    vi.mocked(checkContent).mockResolvedValue({ isOffensive: true, reason: 'nope' })

    await expect(
      generateExpressPrediction('some clearly offensive free-text claim'),
    ).rejects.toThrow(/OFFENSIVE_INPUT/)

    expect(checkContent).toHaveBeenCalledOnce()
  })
})
