/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that transitively uses them
// ---------------------------------------------------------------------------

// Strip authentication — call the inner handler directly with a mock user
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (handler: Function) =>
    async (request: Request, context: { params: Promise<{ id: string }> }) => {
      const params = await context.params
      return handler(request, { id: 'user-1', role: 'USER' }, { ...context, params })
    },
}))

vi.mock('@/lib/capabilities', () => ({ aiResearchEnabled: () => true }))

vi.mock('@/lib/prisma', () => ({
  prisma: { contextTiming: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) } },
}))

vi.mock('@/lib/services/context', () => ({
  getContextTimeline: vi.fn(),
  getForecastForContextUpdate: vi.fn(),
  countUserContextUpdates: vi.fn(),
  saveContextUpdate: vi.fn(),
  listContextSnapshots: vi.fn(),
}))

vi.mock('@/lib/services/oracleSearch', () => ({ oracleSearch: vi.fn() }))
vi.mock('@/lib/llm/searchQuery', () => ({ buildSearchQuery: vi.fn() }))
vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn().mockResolvedValue('Template {{claimText}}'),
  fillPrompt: vi.fn().mockImplementation((t, v) => t + ' ' + Object.values(v).join(' ')),
}))

const generateContentMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: generateContentMock } }))

vi.mock('@/lib/llm/expressPrediction', () => ({ guessChances: vi.fn() }))
vi.mock('@/lib/services/oracle', () => ({
  getOracleForecast: vi.fn(),
  recordOracleFallback: vi.fn(),
  DEFAULT_MAX_ARTICLES: 10,
  INTERACTIVE_FORECAST_TIMEOUT_MS: 12_000,
}))
vi.mock('@/lib/services/forecast-sources', () => ({ getArticleMetaByUrl: vi.fn().mockResolvedValue(new Map()) }))
vi.mock('@/lib/services/evidence-pool', async (importOriginal) => ({
  // `articleIdsByUrl` is taken from the REAL module — see the news-indexer route test's
  // identical mock for why a hand-copied stub here would be the wrong thing.
  ...(await importOriginal<typeof import('@/lib/services/evidence-pool')>()),
  addArticlesToPool: vi.fn(),
  claimArticlesForExtraction: vi.fn(),
}))
vi.mock('@/lib/services/pooled-estimate', () => ({ resolvePooledEstimate: vi.fn() }))

vi.mock('@/lib/api-error', () => ({
  apiError: (msg: string, status: number) => new Response(JSON.stringify({ error: msg }), { status }),
  handleRouteError: () => new Response(JSON.stringify({ error: 'fail' }), { status: 500 }),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { POST } from '../route'
import {
  getForecastForContextUpdate,
  countUserContextUpdates,
  saveContextUpdate,
  listContextSnapshots,
} from '@/lib/services/context'
import { oracleSearch } from '@/lib/services/oracleSearch'
import { buildSearchQuery } from '@/lib/llm/searchQuery'
import { getOracleForecast, INTERACTIVE_FORECAST_TIMEOUT_MS } from '@/lib/services/oracle'
import { guessChances } from '@/lib/llm/expressPrediction'
import { addArticlesToPool, claimArticlesForExtraction } from '@/lib/services/evidence-pool'
import { resolvePooledEstimate } from '@/lib/services/pooled-estimate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE_PREDICTION = {
  id: 'pred-1',
  claimText: 'Will X happen?',
  status: 'ACTIVE',
  contextUpdatedAt: null,
  detailsText: null,
  claimDirection: null,
  claimDeadline: null,
  createdAt: new Date('2026-01-01'),
  claimArchetype: null,
  resolutionRules: null,
  newsAnchor: null,
}

const SEARCH_RESULTS = [
  { title: 'A', url: 'https://a.com/1', snippet: 's1', source: 'a.com', publishedDate: '2026-07-01' },
  { title: 'B', url: 'https://b.com/2', snippet: 's2', source: 'b.com', publishedDate: '2026-07-01' },
]

const ORACLE_FORECAST_ONE_SOURCE = {
  question: 'Will X happen?',
  mean: 0.4,
  std: 0.1,
  ci_low: 0.2,
  ci_high: 0.6,
  articles_used: 1,
  settled: false,
  sources: [
    { source_id: 'b', source_name: 'B', url: 'https://b.com/2', stance: 0.4, certainty: 0.7, credibility_weight: 1.0, relevance_score: 0.8, claims: ['claim'] },
  ],
}

function makeRequest(id = 'pred-1') {
  return new NextRequest(`http://localhost/api/forecasts/${id}/context`, { method: 'POST' })
}

// Drains the streamed SSE response and returns the parsed `done` event's payload.
async function collectDoneEvent(response: Response) {
  const text = await response.text()
  const events = text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)))
  const done = events.find((e) => e.type === 'done')
  if (!done) throw new Error(`no 'done' event in stream: ${text}`)
  return done
}

describe('POST /api/forecasts/[id]/context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getForecastForContextUpdate).mockResolvedValue(BASE_PREDICTION as never)
    vi.mocked(countUserContextUpdates).mockResolvedValue(0)
    vi.mocked(buildSearchQuery).mockResolvedValue('x query')
    vi.mocked(oracleSearch).mockResolvedValue(SEARCH_RESULTS as never)
    generateContentMock.mockResolvedValue({ text: 'A fresh summary.' })
    vi.mocked(addArticlesToPool).mockResolvedValue(undefined)
    vi.mocked(saveContextUpdate).mockResolvedValue({ id: 'snap-1' } as never)
    vi.mocked(listContextSnapshots).mockResolvedValue([] as never)
    // Default: everything searched is newly claimed — existing (pre-fix)
    // behavior for a route that previously had no gate at all.
    vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
    vi.mocked(getOracleForecast).mockResolvedValue({
      forecast: ORACLE_FORECAST_ONE_SOURCE,
      logId: 'log-1',
      insufficientData: false,
    } as never)
    vi.mocked(resolvePooledEstimate).mockResolvedValue({
      mean: 0.4, std: 0.1, ciLow: 0.2, ciHigh: 0.6, settled: false, articlesUsed: 1,
      snapshotSources: ORACLE_FORECAST_ONE_SOURCE.sources.map((s) => ({ ...s, sourceName: s.source_name })),
      estimateSource: 'pool', insufficientData: false, reason: null, poolSize: 2, singleRunMean: 0.4,
    } as never)
  })

  describe('extraction claim gate (daatan#1172)', () => {
    it('only sends newly-claimed articles to the Oracle — an unchanged article must not be re-extracted', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
        { result: 'skip', articleId: 'row-1' },
        { result: 'claimed', articleId: 'row-2' },
      ])

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
      await collectDoneEvent(res)

      expect(getOracleForecast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          articles: [expect.objectContaining({ url: 'https://b.com/2' })],
        }),
        expect.anything(),
      )
    })

    it('asks the Oracle with the INTERACTIVE budget, not the background default (daatan#1254)', async () => {
      // This route races the whole estimation against ESTIMATION_TIMEOUT_MS (15s), so the
      // Oracle call must fit inside it. The service default is 30s — sized for the
      // background push/sweep paths — and inheriting it here would mean the race abandons
      // a call that is still running: the same timeout inversion, one hop further in.
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
      await collectDoneEvent(res)

      expect(getOracleForecast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeoutMs: INTERACTIVE_FORECAST_TIMEOUT_MS }),
        expect.anything(),
      )
      expect(INTERACTIVE_FORECAST_TIMEOUT_MS).toBeLessThan(15_000)
    })

    it('forwards the claim\'s resolutionRules to the Oracle (daatan#1375)', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
      vi.mocked(getForecastForContextUpdate).mockResolvedValue({
        ...BASE_PREDICTION,
        resolutionRules: 'Only an official government announcement counts.',
      } as never)

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
      await collectDoneEvent(res)

      const [, opts] = vi.mocked(getOracleForecast).mock.calls[0]
      expect(opts?.resolutionRules).toBe('Only an official government announcement counts.')
    })

    it('reads the existing pool aggregate directly, without calling the Oracle or the LLM fallback, when every searched article is already unchanged', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
        { result: 'skip', articleId: 'row-1' },
        { result: 'skip', articleId: 'row-2' },
      ])

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
      const done = await collectDoneEvent(res)

      expect(getOracleForecast).not.toHaveBeenCalled()
      expect(guessChances).not.toHaveBeenCalled()
      expect(addArticlesToPool).not.toHaveBeenCalled()
      // resolvePooledEstimate was still called (with an empty fallback set) to
      // read the CURRENT pool, so the estimate reflects existing evidence
      // rather than silently going stale.
      expect(resolvePooledEstimate).toHaveBeenCalledWith(
        'pred-1',
        expect.objectContaining({ articlesUsed: 0 }),
        [],
        // Trailing claimText is the settlement match gate's `question` (daatan#1264).
        null, null, expect.any(Map), expect.any(Date), null, 'Will X happen?',
      )
      expect(done.snapshot).toBeTruthy()
      const saved = vi.mocked(saveContextUpdate).mock.calls[0][0]
      expect(saved.externalProbability).toBe(70) // stanceToPercent(0.4) from the mocked pool result
    })

    it('does not fabricate a number when nothing is new AND the pool itself cannot be read', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
        { result: 'skip', articleId: 'row-1' },
        { result: 'skip', articleId: 'row-2' },
      ])
      vi.mocked(resolvePooledEstimate).mockResolvedValue({
        mean: 0, std: 0, ciLow: 0, ciHigh: 0, settled: false, articlesUsed: 0,
        snapshotSources: [], estimateSource: 'single-run', insufficientData: false,
        reason: null, poolSize: null, singleRunMean: 0,
      } as never)

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })
      await collectDoneEvent(res)

      const saved = vi.mocked(saveContextUpdate).mock.calls[0][0]
      expect(saved.externalProbability).toBeNull()
      expect(guessChances).not.toHaveBeenCalled()
    })

    it('claims the searched articles keyed to this prediction under the analyze origin', async () => {
      await POST(makeRequest(), { params: Promise.resolve({ id: 'pred-1' }) })

      expect(claimArticlesForExtraction).toHaveBeenCalledWith(
        'pred-1',
        [
          expect.objectContaining({ url: 'https://a.com/1' }),
          expect.objectContaining({ url: 'https://b.com/2' }),
        ],
        'analyze',
      )
    })
  })
})
