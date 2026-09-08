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

// daatan#1706 proposal 5: run the same claim-text/deadline cross-check
// POST /api/forecasts uses at creation (#1404) inside generateExpressPrediction
// too, so a mismatch surfaces on the review screen before the author ever
// tries to publish. `claimDeadlineMismatch` is computed by expressPrediction.ts
// itself from the mocked LLM's claimText/resolveByDatetime — unlike the fully
// mocked-pipeline tests elsewhere, this asserts real post-processing logic, not
// the mock's own return value.
function mockPrediction(overrides: Record<string, unknown>) {
  vi.mocked(llmService.generateContent).mockImplementation(
    async ({ schema }: { schema?: unknown }) =>
      schema
        ? {
          text: JSON.stringify({
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
            dateBasis: 'assumed',
            ...overrides,
          }),
        }
        : { text: 'topic' } as never,
  )
}

describe('generateExpressPrediction — claimDeadlineMismatch (#1706)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flags a mismatch (skipSources path) when the claim names a date that disagrees with resolveByDatetime', async () => {
    mockPrediction({
      claimText: 'Israel will hold Knesset elections by June 15, 2027',
      resolveByDatetime: '2027-12-31T23:59:59Z',
    })

    const result = await generateExpressPrediction('some input', undefined, /* skipSources */ true)

    expect(result.claimDeadlineMismatch).not.toBeNull()
    expect(new Date(result.claimDeadlineMismatch!).getUTCFullYear()).toBe(2027)
    expect(new Date(result.claimDeadlineMismatch!).getUTCMonth()).toBe(5) // June, 0-indexed
  })

  it('is null (skipSources path) when the claim and resolveByDatetime agree', async () => {
    mockPrediction({
      claimText: 'Israel will hold Knesset elections by December 31, 2027',
      resolveByDatetime: '2027-12-31T23:59:59Z',
    })

    const result = await generateExpressPrediction('some input', undefined, true)

    expect(result.claimDeadlineMismatch).toBeNull()
  })

  it('is null (skipSources path) when the claim names no explicit date at all', async () => {
    mockPrediction({
      claimText: 'A testable claim with no date in it',
      resolveByDatetime: '2026-11-03T23:59:59Z',
    })

    const result = await generateExpressPrediction('some input', undefined, true)

    expect(result.claimDeadlineMismatch).toBeNull()
  })

  it('flags a mismatch on the sourced (non-skipSources) path too', async () => {
    mockPrediction({
      claimText: 'Israel will hold Knesset elections by June 15, 2027',
      resolveByDatetime: '2027-12-31T23:59:59Z',
    })
    vi.mocked(oracleSearch).mockResolvedValue([
      { title: 'Knesset election news', url: 'https://example.com/a', snippet: 's', source: 'example.com', publishedDate: undefined },
    ])

    const result = await generateExpressPrediction('Israel elections')

    expect(result.claimDeadlineMismatch).not.toBeNull()
  })
})
