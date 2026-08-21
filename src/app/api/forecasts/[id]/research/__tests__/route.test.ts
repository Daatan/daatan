/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetRateLimitStore } from '@/lib/rate-limit'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that transitively uses them
// ---------------------------------------------------------------------------

// Strip authentication — call the inner handler directly with a mock admin user
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (handler: Function) =>
    async (request: Request, context: { params: Promise<{ id: string }> }) => {
      const params = await context.params
      return handler(request, { id: 'admin-user', role: 'ADMIN' }, { ...context, params })
    },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    evidencePoolArticle: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/services/oracleSearch', () => ({
  oracleSearch: vi.fn(),
}))
vi.mock('@/lib/utils/multilingualSearch', () => ({
  searchArticlesMultilingual: vi.fn(),
}))

const generateContentMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({
  llmService: { generateContent: generateContentMock },
}))

vi.mock('@/lib/llm/bedrock-prompts', () => ({
    getPromptTemplate: vi.fn().mockImplementation((name: string) =>
        Promise.resolve(name === 'research-query-generation'
            ? 'QueryGen template: {{claimText}}'
            : 'Mock template: {{claimText}} {{forecastStartStr}} {{forecastEndStr}} {{context}} Do NOT default to')),
    fillPrompt: vi.fn().mockImplementation((t, v) => t + ' ' + Object.values(v).join(' ')),
}))

vi.mock('@/lib/api-error', () => ({
  apiError: (msg: string, status: number) => new Response(JSON.stringify({ error: msg }), { status }),
  handleRouteError: (err: unknown, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 500 }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { oracleSearch } from '@/lib/services/oracleSearch'
import { searchArticlesMultilingual } from '@/lib/utils/multilingualSearch'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const basePrediction = {
  id: 'pred-1',
  claimText: 'The Israeli Shekel will strengthen against the US Dollar by end of February 2026',
  outcomeType: 'BINARY',
  resolutionRules: null,
  publishedAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  resolveByDatetime: new Date('2026-02-24'),
  options: [],
}

let _articleSeq = 0
const makeArticle = (title: string, source = 'example.com') => ({
  title,
  url: `https://${source}/article-${++_articleSeq}`,
  snippet: `${title} — detailed report`,
  source,
  publishedDate: 'Feb 10, 2026',
})

const makeRequest = (id = 'pred-1') =>
  new NextRequest(`http://localhost/api/forecasts/${id}/research`, { method: 'POST' })

const isQueryGenPrompt = (prompt: string) => prompt.startsWith('QueryGen')

// Default LLM behaviour: query generation returns one targeted query,
// evaluation returns a 'correct' outcome. Individual tests override via
// mockResolvedValueOnce chains where call order matters.
const mockLlmDefaults = (
  outcome: object = { outcome: 'correct', reasoning: 'Multiple sources confirm the shekel strengthened.', evidenceLinks: ['https://timesofisrael.com/article'] },
  queries: string[] = ['shekel usd rate 2026'],
) => {
  generateContentMock.mockImplementation(({ prompt }: { prompt: string }) =>
    Promise.resolve({
      text: JSON.stringify(isQueryGenPrompt(prompt) ? { queries } : outcome),
    }))
}

const evalPrompt = (): string => {
  const call = generateContentMock.mock.calls.find(c => !isQueryGenPrompt(c[0].prompt))
  if (!call) throw new Error('no evaluation LLM call recorded')
  return call[0].prompt
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/forecasts/[id]/research', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitStore()
    // No curated pool by default — pool-specific tests override this
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([])
    // Main oracle returns null → falls through to three parallel searches
    vi.mocked(oracleSearch).mockResolvedValue(null)
    // Default: searches return relevant shekel articles
    vi.mocked(searchArticlesMultilingual).mockResolvedValue([
      makeArticle('Shekel hits 30-year high', 'timesofisrael.com'),
      makeArticle('Shekel continues rise', 'jns.org'),
      makeArticle('ILS strengthens against dollar', 'reuters.com'),
    ])
    mockLlmDefaults()
  })

  it('returns 404 when the prediction is not found', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'missing' }) })
    expect(response.status).toBe(404)
  })

  it('runs three parallel searches plus the targeted queries and merges results', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    // dated + broad + simplified + 1 targeted query × 2 legs (current + pre-creation)
    expect(searchArticlesMultilingual).toHaveBeenCalledTimes(5)
  })

  it('the simplified query strips stopwords and includes the resolution year', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const calls = vi.mocked(searchArticlesMultilingual).mock.calls
    // The third call is the simplified/keyword query
    const simplifiedQuery: string = calls[2][0]
    expect(simplifiedQuery.toLowerCase()).not.toMatch(/\bwill\b/)
    expect(simplifiedQuery.toLowerCase()).not.toMatch(/\bthe\b/)
    expect(simplifiedQuery).toContain('2026')
  })

  it('caps searches at the deadline but never floors them at creation (daatan#1511)', async () => {
    // The creation-date floor hid a resolving event that happened six days before
    // the claim existed (Brent $100): the claim window has no lower bound unless
    // the claim text states one, so searches must not invent one.
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const calls = vi.mocked(searchArticlesMultilingual).mock.calls
    // calls[0] = dated, calls[2] = simplified — deadline-capped, no lower bound
    expect(calls[0][2]).toMatchObject({ dateTo: expect.any(Date) })
    expect(calls[0][2]!.dateFrom).toBeUndefined()
    expect(calls[2][2]).toMatchObject({ dateTo: expect.any(Date) })
    expect(calls[2][2]!.dateFrom).toBeUndefined()
    // calls[1] = broad — no date options
    expect(calls[1][2]).toBeUndefined()
  })

  it('runs a pre-creation leg per targeted query — the born-true detector (daatan#1511)', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const calls = vi.mocked(searchArticlesMultilingual).mock.calls
    // calls[3] = targeted current leg, calls[4] = targeted pre-creation leg
    const targeted = calls.slice(3)
    expect(targeted).toHaveLength(2)
    expect(targeted[0][2]!.dateFrom).toBeUndefined()
    // The pre-creation leg's window ends at the claim's publishedAt/createdAt, so a
    // strictly historical window reaches the date-honoring SERP providers (retro#559).
    expect(targeted[1][2]!.dateTo!.getTime()).toBe(new Date('2026-01-01').getTime())
  })

  it('extends the search window a few days past an expired deadline', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const dateTo: Date = vi.mocked(searchArticlesMultilingual).mock.calls[0][2]!.dateTo!
    // Deadline 2026-02-24 is long past → window ends 3 days after it, not at it
    expect(dateTo.getTime()).toBe(new Date('2026-02-27').getTime())
  })

  it('caps the search window at now while the forecast is still open', async () => {
    const openPrediction = { ...basePrediction, resolveByDatetime: new Date(Date.now() + 30 * 86400_000) }
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(openPrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const dateTo: Date = vi.mocked(searchArticlesMultilingual).mock.calls[0][2]!.dateTo!
    expect(dateTo.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('returns the LLM outcome as JSON', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.outcome).toBe('correct')
    expect(data.reasoning).toBeTruthy()
    expect(data.evidenceLinks).toBeInstanceOf(Array)
  })

  it('runs the targeted LLM queries even when initial results look relevant', async () => {
    // Regression for daatan#1467: relevance heuristics can't detect that roundup
    // snippets omit the specific entity, so targeted queries must always run.
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(searchArticlesMultilingual).mockResolvedValue([
      makeArticle('Israeli Shekel hits high'),
      makeArticle('Israeli economy update'),
      makeArticle('Shekel dollar exchange'),
    ])

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    // 3 initial + 1 targeted query × 2 legs; LLM called for query gen + evaluation
    expect(searchArticlesMultilingual).toHaveBeenCalledTimes(5)
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('keeps targeted-query results in the LLM context when primary results are plentiful', async () => {
    // Regression for daatan#1467 (Pixel 11): oracle returns a full page of
    // roundups; the targeted query surfaces the one entity-specific article,
    // which must survive the result cap and reach the evaluation prompt.
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(oracleSearch).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => makeArticle(`Everything announced roundup ${i + 1}`))
    )
    vi.mocked(searchArticlesMultilingual).mockResolvedValue([
      makeArticle('Shekel specifically strengthened, confirms central bank', 'reuters.com'),
    ])

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    expect(evalPrompt()).toContain('Shekel specifically strengthened, confirms central bank')
  })

  it('includes published dates in the LLM context', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(searchArticlesMultilingual).mockResolvedValue([
      makeArticle('Israeli Shekel strengthens', 'timesofisrael.com'),
      makeArticle('Shekel at 30-year high', 'jns.org'),
      makeArticle('Israeli currency rises', 'reuters.com'),
    ])

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    expect(evalPrompt()).toContain('Feb 10, 2026')
  })

  it('passes the forecast period dates to the LLM prompt', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const promptArg = evalPrompt()
    expect(promptArg).toContain('2026-01-01')  // forecastStart
    expect(promptArg).toContain('2026-02-24')  // forecastEnd
  })

  it('tells LLM to use its own knowledge when search context is empty', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(searchArticlesMultilingual).mockResolvedValue([])
    mockLlmDefaults({ outcome: 'unresolvable', reasoning: 'no evidence', evidenceLinks: [] })

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const promptArg = evalPrompt()
    expect(promptArg).toContain('Rely on your training knowledge')
    expect(promptArg).toContain('Do NOT default to')
  })

  it('includes MULTIPLE_CHOICE options in the LLM prompt', async () => {
    const mcPrediction = {
      ...basePrediction,
      outcomeType: 'MULTIPLE_CHOICE',
      options: [
        { id: 'opt-1', text: 'Yes, it strengthens' },
        { id: 'opt-2', text: 'No, it weakens' },
      ],
    }
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(mcPrediction as never)
    vi.mocked(searchArticlesMultilingual).mockResolvedValue([
      makeArticle('Israeli Shekel surges', 'timesofisrael.com'),
      makeArticle('Israeli economy boom', 'jns.org'),
      makeArticle('Shekel dollar rate rises', 'reuters.com'),
    ])

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const promptArg = evalPrompt()
    expect(promptArg).toContain('MULTIPLE CHOICE')
    expect(promptArg).toContain('opt-1')
    expect(promptArg).toContain('Yes, it strengthens')
  })

  it('continues gracefully when the targeted LLM query generation fails', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    // First call (query gen) throws, second call (evaluation) succeeds
    generateContentMock
      .mockRejectedValueOnce(new Error('LLM rate limit'))
      .mockResolvedValueOnce({ text: JSON.stringify({ outcome: 'unresolvable', reasoning: 'no data', evidenceLinks: [] }) })

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.outcome).toBe('unresolvable')
  })

  it('continues gracefully when a targeted search call fails', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(searchArticlesMultilingual)
      .mockResolvedValueOnce([makeArticle('Tariff news')])   // dated
      .mockResolvedValueOnce([makeArticle('Tariff court')])  // broad
      .mockResolvedValueOnce([makeArticle('Trade war')])     // simplified
      .mockRejectedValue(new Error('Search timeout'))        // targeted searches fail

    generateContentMock
      .mockResolvedValueOnce({ text: JSON.stringify({ queries: ['shekel usd', 'ILS rate'] }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ outcome: 'unresolvable', reasoning: 'targeted search failed', evidenceLinks: [] }) })

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
    expect(response.status).toBe(200)
  })

  it('includes the curated evidence pool in the LLM context, settlement rows flagged', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([
      {
        url: 'https://reuters.com/deal-signed', title: 'Agreement formally signed', source: 'reuters.com',
        publishedDate: '2026-01-05', stance: 0.9, settled: true, settlementEventDate: '2026-01-04',
        evidenceClass: 'reported_fact',
      },
      {
        url: 'https://example.com/analysis', title: 'Deal still uncertain, analysts say', source: 'example.com',
        publishedDate: '2026-01-02', stance: -0.2, settled: null, settlementEventDate: null,
        evidenceClass: 'reporting',
      },
    ] as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const promptArg = evalPrompt()
    expect(promptArg).toContain('Curated evidence pool')
    expect(promptArg).toContain('Agreement formally signed')
    expect(promptArg).toContain('SETTLEMENT ASSERTED on 2026-01-04')
    expect(promptArg).toContain('Deal still uncertain, analysts say')
  })

  it('survives a pool lookup failure and still answers from search context', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(prisma.evidencePoolArticle.findMany).mockRejectedValue(new Error('db down'))

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
    expect(response.status).toBe(200)
  })

  it('runs the verdict on the pro-tier model and query generation on the chain default', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)

    await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

    const queryGenCall = generateContentMock.mock.calls.find(c => isQueryGenPrompt(c[0].prompt))
    const verdictCall = generateContentMock.mock.calls.find(c => !isQueryGenPrompt(c[0].prompt))
    expect(queryGenCall![0].model).toBeUndefined()
    expect(verdictCall![0].model).toBe('gemini-2.5-pro')
  })

  it('returns 200 with LLM result when all three initial searches fail', async () => {
    // TEST-3: all three parallel .catch(() => []) searches reject simultaneously.
    // The route should still call the LLM with empty context and return 200.
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    vi.mocked(searchArticlesMultilingual).mockRejectedValue(new Error('Search provider down'))
    mockLlmDefaults({ outcome: 'unresolvable', reasoning: 'No search results available', evidenceLinks: [] })

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.outcome).toBe('unresolvable')
  })
})
