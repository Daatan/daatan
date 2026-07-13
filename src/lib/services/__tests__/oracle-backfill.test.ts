/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockSearch,
  mockForecast,
  mockMeta,
  mockSave,
  mockMark,
  mockBuildQuery,
  mockAddToPool,
  mockShadowCompare,
  mockClaim,
  mockFailClaimed,
} = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockForecast: vi.fn(),
  mockMeta: vi.fn(),
  mockSave: vi.fn(),
  mockMark: vi.fn(),
  mockBuildQuery: vi.fn(),
  mockAddToPool: vi.fn(),
  mockShadowCompare: vi.fn(),
  mockClaim: vi.fn(),
  mockFailClaimed: vi.fn(),
}))

vi.mock('@/lib/services/oracleSearch', () => ({ oracleSearch: (...a: unknown[]) => mockSearch(...a) }))
vi.mock('@/lib/llm/searchQuery', () => ({ buildSearchQuery: (...a: unknown[]) => mockBuildQuery(...a) }))
vi.mock('@/lib/services/oracle', () => ({
  getOracleForecast: (...a: unknown[]) => mockForecast(...a),
  DEFAULT_MAX_ARTICLES: 15,
}))
vi.mock('@/lib/services/forecast-sources', () => ({ getArticleMetaByUrl: (...a: unknown[]) => mockMeta(...a) }))
vi.mock('@/lib/services/context', () => ({
  saveOracleSnapshotOnly: (...a: unknown[]) => mockSave(...a),
  markOracleAttempted: (...a: unknown[]) => mockMark(...a),
}))
vi.mock('@/lib/services/evidence-pool', () => ({
  addArticlesToPool: (...a: unknown[]) => mockAddToPool(...a),
  shadowCompareRecompute: (...a: unknown[]) => mockShadowCompare(...a),
  claimArticlesForExtraction: (...a: unknown[]) => mockClaim(...a),
  failClaimedArticles: (...a: unknown[]) => mockFailClaimed(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { refreshOracleSnapshot } from '../oracle-backfill'

const prediction = { id: 'p1', claimText: 'Will X happen?' }

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildQuery.mockResolvedValue('x query')
  mockMeta.mockResolvedValue(new Map())
  mockAddToPool.mockResolvedValue(undefined)
  mockShadowCompare.mockResolvedValue(undefined)
  // Default: the claim gate always admits the run (existing tests exercise the
  // "something new" path); the skip-when-unchanged path has its own tests below.
  mockClaim.mockResolvedValue(['claimed'])
  mockFailClaimed.mockResolvedValue(undefined)
})

describe('refreshOracleSnapshot', () => {
  it('marks attempted (so the backfill converges) when search finds no articles', async () => {
    mockSearch.mockResolvedValue([])
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'no-articles' })
    expect(mockMark).toHaveBeenCalledWith('p1', 'no-articles')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('marks attempted when the Oracle returns no usable forecast', async () => {
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({ forecast: null })
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'no-oracle' })
    expect(mockMark).toHaveBeenCalledWith('p1', 'no-oracle')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('persists the enriched snapshot on success (no attempted marker)', async () => {
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({
      forecast: {
        mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1,
        sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://a.com/1', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
      },
    })
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'ok', sources: 1 })
    expect(mockMark).not.toHaveBeenCalled()
    expect(mockSave).toHaveBeenCalledTimes(1)
    const saved = mockSave.mock.calls[0][0]
    expect(saved.predictionId).toBe('p1')
    expect(saved.oracleSnapshot.sources[0]).toMatchObject({ sourceName: 'BBC', stance: 0.2 })
  })

  it('forwards claimDirection/claimDeadline to getOracleForecast when present on the prediction', async () => {
    const deadline = new Date('2026-12-31T00:00:00.000Z')
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({ forecast: null })
    await refreshOracleSnapshot({ ...prediction, claimDirection: 'SURVIVAL', claimDeadline: deadline })
    const [, opts] = mockForecast.mock.calls[0]
    expect(opts.claimDirection).toBe('SURVIVAL')
    expect(opts.claimDeadline).toBe(deadline)
  })

  describe('evidence pool shadow-write + recompute shadow-compare (retro ORACLE_VARIABLES.md §6 step 6)', () => {
    const forecast = {
      mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1, settled: false,
      sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://a.com/1', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
    }

    it('shadow-writes the pool and shadow-compares the recompute on success', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })

      await refreshOracleSnapshot(prediction)

      await vi.waitFor(() => expect(mockShadowCompare).toHaveBeenCalledTimes(1))
      expect(mockAddToPool).toHaveBeenCalledWith('p1', expect.any(Array), 'backfill')
      expect(mockShadowCompare).toHaveBeenCalledWith(
        'p1',
        { mean: 0.2, ciLow: 0.0, ciHigh: 0.4, settled: false },
        null,
        null,
      )
    })

    it('normalizes a prediction with no claimDirection/claimDeadline fields to null (not undefined) for the shadow-compare', async () => {
      // `prediction` fixture has neither key at all, matching a real Prisma row's
      // nullable columns coming back as `null`, not TS-optional `undefined`.
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })

      await refreshOracleSnapshot(prediction)

      await vi.waitFor(() => expect(mockShadowCompare).toHaveBeenCalledTimes(1))
      const [, , claimDirection, claimDeadline] = mockShadowCompare.mock.calls[0]
      expect(claimDirection).toBeNull()
      expect(claimDeadline).toBeNull()
    })

    it('forwards a set claimDirection/claimDeadline to the shadow-compare', async () => {
      const deadline = new Date('2026-12-31T00:00:00.000Z')
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })

      await refreshOracleSnapshot({ ...prediction, claimDirection: 'SURVIVAL', claimDeadline: deadline })

      await vi.waitFor(() => expect(mockShadowCompare).toHaveBeenCalledTimes(1))
      expect(mockShadowCompare).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ mean: 0.2 }),
        'SURVIVAL',
        deadline,
      )
    })

    it('does not shadow-compare when the Oracle returns no usable forecast', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast: null })

      await refreshOracleSnapshot(prediction)

      expect(mockAddToPool).not.toHaveBeenCalled()
      expect(mockShadowCompare).not.toHaveBeenCalled()
    })
  })

  describe('extraction claim gate (evidence-pool.ts)', () => {
    it('reports status: unchanged and skips the Oracle call when every searched article is already claimed/unchanged', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockClaim.mockResolvedValue(['skip'])

      const r = await refreshOracleSnapshot(prediction)

      expect(r).toEqual({ status: 'unchanged' })
      expect(mockForecast).not.toHaveBeenCalled()
      expect(mockSave).not.toHaveBeenCalled()
      expect(mockMark).not.toHaveBeenCalled()
    })

    it('claims the searched articles before calling the Oracle', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's', source: 'a.com', publishedDate: '2026-07-01' }])
      mockForecast.mockResolvedValue({ forecast: null })

      await refreshOracleSnapshot(prediction)

      expect(mockClaim).toHaveBeenCalledWith(
        'p1',
        [{ url: 'https://a.com/1', title: 't', snippet: 's', source: 'a.com', publishedAt: '2026-07-01' }],
        'backfill',
      )
    })

    it('releases the claim (FAILED, oracle_null) and still marks attempted when the Oracle returns no usable forecast', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast: null })

      await refreshOracleSnapshot(prediction)

      expect(mockFailClaimed).toHaveBeenCalledWith('p1', ['https://a.com/1'], 'oracle_null')
      expect(mockMark).toHaveBeenCalledWith('p1', 'no-oracle')
    })

    it('releases the claim (FAILED, extractor_error) and rethrows when the Oracle call itself throws', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockRejectedValue(new Error('oracle timeout'))

      await expect(refreshOracleSnapshot(prediction)).rejects.toThrow('oracle timeout')
      expect(mockFailClaimed).toHaveBeenCalledWith('p1', ['https://a.com/1'], 'extractor_error')
    })
  })
})
