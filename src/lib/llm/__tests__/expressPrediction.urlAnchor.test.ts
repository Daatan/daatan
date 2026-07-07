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

import { generateExpressPrediction, NoArticlesFoundError, extractFirstUrl } from '../expressPrediction'
import { checkContent } from '../../services/moderation'
import { fetchUrlContent } from '../../utils/scraper'
import { oracleSearch } from '../../services/oracleSearch'
import { llmService } from '../index'

const WALLA = 'https://news.walla.co.il/item/3851564'
const YNET = 'https://www.ynet.co.il/news/article/s1enybqxzl'

// A well-formed LLM response so the pipeline runs to completion.
const PREDICTION = {
  claimText: 'Likud will win the most Knesset seats in the next election',
  resolveByDatetime: '2026-11-03T23:59:59Z',
  detailsText: 'Context sentence.',
  tags: ['Elections'],
  resolutionRules: 'Resolved by official Knesset election results.',
  outcomeType: 'BINARY',
  options: [],
  probabilitySuggestion: 55,
  probabilityReasoning: 'Based on current polling.',
  relevantArticleIndices: [1],
}

describe('extractFirstUrl', () => {
  it('returns a bare URL unchanged', () => {
    expect(extractFirstUrl(WALLA)).toBe(WALLA)
  })
  it('finds a URL that follows free text', () => {
    expect(extractFirstUrl(`Will Likud win the election? ${WALLA}`)).toBe(WALLA)
  })
  it('finds a URL that precedes free text', () => {
    expect(extractFirstUrl(`${WALLA} — what do you think?`)).toBe(WALLA)
  })
  it('finds a URL embedded in non-Latin (Hebrew) text', () => {
    expect(extractFirstUrl(`האם ליכוד ינצח? ${WALLA}`)).toBe(WALLA)
  })
  it('strips trailing sentence punctuation and closing brackets', () => {
    expect(extractFirstUrl(`see ${WALLA}.`)).toBe(WALLA)
    expect(extractFirstUrl(`(${WALLA})`)).toBe(WALLA)
  })
  it('matches http as well as https', () => {
    expect(extractFirstUrl('http://insecure.example.com/a')).toBe('http://insecure.example.com/a')
  })
  it('returns null when there is no URL', () => {
    expect(extractFirstUrl('just a plain text claim, no link at all')).toBeNull()
  })
})

describe('generateExpressPrediction — the user-supplied URL is always the news anchor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkContent).mockResolvedValue({ isOffensive: false, reason: '' })
    vi.mocked(llmService.generateContent).mockImplementation(
      // The main prediction call passes a schema; the topic-extraction call does not.
      async ({ schema }: { schema?: unknown }) =>
        schema ? { text: JSON.stringify(PREDICTION) } : { text: 'Israeli elections' } as never,
    )
  })

  it('URL + text: anchors on the pasted URL, never on a search result (Bug: Ynet replaced Walla)', async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue('Likud Leads In New Poll. Body of the article continues here.')
    // The Oracle returns a different outlet — it must NOT become the anchor.
    vi.mocked(oracleSearch).mockResolvedValue([
      { title: 'Ynet coverage', url: YNET, snippet: 's', source: 'ynet.co.il', publishedDate: undefined },
    ])

    const result = await generateExpressPrediction(`Will Likud win the election? ${WALLA}`)

    expect(result.newsAnchor?.url).toBe(WALLA)
    expect(result.newsAnchor?.source).toBe('news.walla.co.il')
    expect(result.additionalLinks.every(l => l.url !== WALLA)).toBe(true)
  })

  it('bare URL whose scrape fails (bot-blocked) still anchors on the URL — no NoArticlesFoundError', async () => {
    // Walla blocks scrapers; the Oracle finds nothing related. Andrej's exact case.
    vi.mocked(fetchUrlContent).mockRejectedValue(new Error('403 Forbidden'))
    vi.mocked(oracleSearch).mockResolvedValue([])

    const result = await generateExpressPrediction(WALLA)

    expect(result.newsAnchor?.url).toBe(WALLA)
    expect(result.newsAnchor?.source).toBe('news.walla.co.il')
  })

  it('URL + text whose scrape fails keeps the URL as anchor and the user text as the snippet', async () => {
    vi.mocked(fetchUrlContent).mockRejectedValue(new Error('paywall'))
    vi.mocked(oracleSearch).mockResolvedValue([])

    const result = await generateExpressPrediction(`Will Likud win the election? ${WALLA}`)

    expect(result.newsAnchor?.url).toBe(WALLA)
    expect(result.newsAnchor?.snippet).toBe('Will Likud win the election?')
  })

  it('text-only input with no results still throws NoArticlesFoundError (unchanged)', async () => {
    vi.mocked(oracleSearch).mockResolvedValue([])

    await expect(
      generateExpressPrediction('a plain free-text claim with no link'),
    ).rejects.toBeInstanceOf(NoArticlesFoundError)
  })
})
