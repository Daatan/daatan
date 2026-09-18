import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/moderation', () => ({ checkContent: vi.fn(async () => ({ isOffensive: false, reason: '' })) }))
vi.mock('../../utils/scraper', () => ({ fetchUrlContent: vi.fn() }))
vi.mock('../../services/oracleSearch', () => ({ oracleSearch: vi.fn(async () => []) }))
vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('../searchQuery', () => ({ buildSearchQuery: vi.fn(async (t: string) => t) }))
vi.mock('../bedrock-prompts', () => ({
  getPromptTemplate: vi.fn(async () => 'TEMPLATE'),
  // Echo the articles text into the prompt so a test can see what the model was shown.
  fillPrompt: vi.fn((_t: string, vars: Record<string, unknown>) => `PROMPT\n${String(vars.articlesText ?? '')}`),
}))
vi.mock('../../services/translation', () => ({ localizeForecastForAuthor: vi.fn(async () => null) }))
vi.mock('../groundedDateLookup', () => ({ lookupGroundedEventDate: vi.fn() }))

import { generateExpressPrediction } from '../expressPrediction'
import { llmService } from '../index'
import { oracleSearch } from '../../services/oracleSearch'
import { lookupGroundedEventDate } from '../groundedDateLookup'

// daatan#1706 option 2: when the first draft admits its resolution date is "assumed",
// look the deciding event's date up on the web and draft again with it in front of the
// model. Everything here is about the orchestration — when the lookup fires, what the
// re-draft is shown, and that no failure on this path can cost the author their draft.
const BASE = {
  claimText: 'The Federal Reserve will cut the federal funds rate at its next FOMC meeting.',
  resolveByDatetime: '2026-12-31T23:59:59Z',
  detailsText: 'Context.',
  tags: ['Economy'],
  resolutionRules: 'Resolved by the FOMC statement.',
  outcomeType: 'BINARY',
  options: [],
  probabilitySuggestion: 50,
  probabilityReasoning: 'Reasoning.',
  relevantArticleIndices: [1],
  dateBasis: 'assumed',
}
const REDRAFT = { ...BASE, resolveByDatetime: '2026-10-28T23:59:59Z', dateBasis: 'from_sources' }
const FOUND = {
  status: 'found' as const,
  event: 'FOMC meeting',
  date: '2026-10-28',
  sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
}
const ARTICLE = { title: 'Fed watch', url: 'https://example.com/fed', snippet: 'Markets expect a cut.', source: 'Example' }

/** Queue the structured drafts in order; un-schema'd calls (topic extraction) get a stub. */
function mockDrafts(...drafts: Array<Record<string, unknown> | Error>) {
  const queue = [...drafts]
  vi.mocked(llmService.generateContent).mockImplementation((async ({ schema }: { schema?: unknown }) => {
    if (!schema) return { text: 'topic' }
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected extra draft call')
    if (next instanceof Error) throw next
    return { text: JSON.stringify(next) }
  }) as never)
}

function draftPrompts(): string[] {
  return vi.mocked(llmService.generateContent).mock.calls
    .map(([req]) => req as { prompt: string; schema?: unknown })
    .filter(req => req.schema)
    .map(req => req.prompt)
}

describe('generateExpressPrediction — grounded event-date lookup (#1706)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(oracleSearch).mockResolvedValue([ARTICLE] as never)
  })

  it('re-drafts with the looked-up date ahead of the articles, and returns the re-draft', async () => {
    mockDrafts(BASE, REDRAFT)
    vi.mocked(lookupGroundedEventDate).mockResolvedValue(FOUND)

    const result = await generateExpressPrediction('The Fed cuts rates at its next meeting')

    expect(lookupGroundedEventDate).toHaveBeenCalledWith(
      'The Fed cuts rates at its next meeting', BASE.claimText, expect.any(Date),
    )
    const [first, second] = draftPrompts()
    expect(first).not.toContain('[Reference')
    expect(second).toContain('Event: FOMC meeting\nDate: 2026-10-28\nSource: https://www.federalreserve.gov')
    // Prepended, so [Article N] numbering — and relevantArticleIndices — is unchanged.
    expect(second.indexOf('[Reference')).toBeLessThan(second.indexOf('[Article 1]'))

    expect(result.resolveByDatetime).toBe('2026-10-28T23:59:59Z')
    expect(result.dateBasis).toBe('from_sources')
    expect(result.groundedDate).toEqual({ fired: true, ...FOUND, adopted: true })
    expect(result.newsAnchor?.url).toBe(ARTICLE.url)
  })

  it('does not flag the looked-up year as ungrounded — the reference block is part of the grounding text', async () => {
    mockDrafts(
      { ...BASE, resolveByDatetime: '2027-12-31T23:59:59Z' },
      { ...REDRAFT, claimText: 'The RN candidate reaches the second round on April 18, 2027.', resolveByDatetime: '2027-04-18T23:59:59Z' },
    )
    vi.mocked(lookupGroundedEventDate).mockResolvedValue({ ...FOUND, event: 'French presidential election, first round', date: '2027-04-18' })

    const result = await generateExpressPrediction('Le Pen candidate reaches the second round', undefined, /* skipSources */ true)

    expect(result.ungroundedYears).toEqual([])
    expect(result.groundedDate).toMatchObject({ status: 'found', adopted: true })
  })

  it('runs on the source-free path too — it has no articles and assumes most', async () => {
    mockDrafts(BASE, REDRAFT)
    vi.mocked(lookupGroundedEventDate).mockResolvedValue(FOUND)

    const result = await generateExpressPrediction('The Fed cuts rates at its next meeting', undefined, true)

    expect(draftPrompts()[1]).toContain('Date: 2026-10-28')
    expect(result.resolveByDatetime).toBe('2026-10-28T23:59:59Z')
    expect(oracleSearch).not.toHaveBeenCalled()
  })

  it.each(['explicit_in_claim', 'from_sources'])('does not look anything up when the first draft reports %s', async basis => {
    mockDrafts({ ...BASE, dateBasis: basis })

    const result = await generateExpressPrediction('some input')

    expect(lookupGroundedEventDate).not.toHaveBeenCalled()
    expect(draftPrompts()).toHaveLength(1)
    expect(result.groundedDate).toEqual({ fired: false })
  })

  it.each(['no_date', 'unavailable'] as const)('keeps the first draft and its "assumed" warning when the lookup is %s', async status => {
    mockDrafts(BASE)
    vi.mocked(lookupGroundedEventDate).mockResolvedValue({ status })

    const result = await generateExpressPrediction('some input')

    expect(draftPrompts()).toHaveLength(1)
    expect(result.dateBasis).toBe('assumed')
    expect(result.resolveByDatetime).toBe(BASE.resolveByDatetime)
    expect(result.groundedDate).toEqual({ fired: true, status })
  })

  it('keeps the first draft when the re-draft fails — losing the date must not lose the forecast', async () => {
    mockDrafts(BASE, new Error('all providers failed'))
    vi.mocked(lookupGroundedEventDate).mockResolvedValue(FOUND)

    const result = await generateExpressPrediction('some input')

    expect(result.resolveByDatetime).toBe(BASE.resolveByDatetime)
    expect(result.dateBasis).toBe('assumed')
    expect(result.groundedDate).toEqual({ fired: true, ...FOUND, adopted: false })
  })

  it('records adopted:false when the re-draft ignores the date, so the miss is measurable', async () => {
    mockDrafts(BASE, { ...BASE })
    vi.mocked(lookupGroundedEventDate).mockResolvedValue(FOUND)

    const result = await generateExpressPrediction('some input')

    expect(result.groundedDate).toMatchObject({ status: 'found', adopted: false })
    expect(result.dateBasis).toBe('assumed')
  })

  it('omits the Source line when the lookup has no usable URL', async () => {
    mockDrafts(BASE, REDRAFT)
    vi.mocked(lookupGroundedEventDate).mockResolvedValue({ ...FOUND, sourceUrl: '' })

    await generateExpressPrediction('some input')

    // Adjacent lines: no empty "Source:" between the date and the closing sentence.
    expect(draftPrompts()[1]).toContain('Date: 2026-10-28\nThis date is stated')
  })

  it('still propagates a failure of the first draft — there is nothing to fall back to', async () => {
    mockDrafts(new Error('all providers failed'))

    await expect(generateExpressPrediction('some input')).rejects.toThrow('all providers failed')
    expect(lookupGroundedEventDate).not.toHaveBeenCalled()
  })
})
