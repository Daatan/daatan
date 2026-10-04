import { describe, it, expect, beforeEach, vi } from 'vitest'

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

import { generateExpressPrediction } from '../expressPrediction'
import { llmService } from '../index'
import { oracleSearch } from '../../services/oracleSearch'

const SEVEN_TAGS = [' Middle East ', 'Economy', 'economy', '', 'Geopolitics', 'Climate', 'Science', 'Conflict', 'Energy']

function mockPrediction(tags: unknown[]) {
  vi.mocked(llmService.generateContent).mockImplementation(
    async ({ schema }: { schema?: unknown }) =>
      schema
        ? {
          text: JSON.stringify({
            claimText: 'A major event starting in the Middle East will reshape the economy by December 31, 2027',
            resolveByDatetime: '2027-12-31T23:59:59Z',
            detailsText: 'Context.',
            tags,
            resolutionRules: 'Resolved by credible reporting.',
            outcomeType: 'BINARY',
            options: [],
            probabilitySuggestion: 10,
            probabilityReasoning: 'Reasoning.',
            relevantArticleIndices: [1],
            dateBasis: 'explicit_in_claim',
          }),
        }
        : { text: 'topic' } as never,
  )
}

// daatan#1787: the prompt asks for 1-3 tags but the model returned more than the
// publish schema's cap, and every Publish click failed. The draft is normalised
// before it reaches the review screen.
describe('generateExpressPrediction — tag normalisation (#1787)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trims, dedupes and caps tags at 5 on the source-free path', async () => {
    mockPrediction(SEVEN_TAGS)
    const result = await generateExpressPrediction('some input', undefined, /* skipSources */ true)
    expect(result.tags).toEqual(['Middle East', 'Economy', 'Geopolitics', 'Climate', 'Science'])
  })

  it('caps tags at 5 on the sourced path too', async () => {
    mockPrediction(SEVEN_TAGS)
    vi.mocked(oracleSearch).mockResolvedValue([
      { title: 'Regional news', url: 'https://example.com/a', snippet: 's', source: 'example.com', publishedDate: undefined },
    ])
    const result = await generateExpressPrediction('Middle East event')
    expect(result.tags).toHaveLength(5)
  })

  it('tolerates a missing tags field', async () => {
    mockPrediction(undefined as unknown as unknown[])
    const result = await generateExpressPrediction('some input', undefined, true)
    expect(result.tags).toEqual([])
  })
})
