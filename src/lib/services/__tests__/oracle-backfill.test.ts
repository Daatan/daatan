/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  mockSearch,
  mockForecast,
  mockMeta,
  mockSave,
  mockMark,
  mockBuildQuery,
  mockAddToPool,
  mockResolvePooled,
  mockClaim,
  mockFailClaimed,
  mockPredictionFind,
} = vi.hoisted(() => ({
  mockPredictionFind: vi.fn(),
  mockSearch: vi.fn(),
  mockForecast: vi.fn(),
  mockMeta: vi.fn(),
  mockSave: vi.fn(),
  mockMark: vi.fn(),
  mockBuildQuery: vi.fn(),
  mockAddToPool: vi.fn(),
  mockResolvePooled: vi.fn(),
  mockClaim: vi.fn(),
  mockFailClaimed: vi.fn(),
}))

vi.mock('@/lib/services/oracleSearch', () => ({ oracleSearch: (...a: unknown[]) => mockSearch(...a) }))
vi.mock('@/lib/llm/searchQuery', () => ({ buildSearchQuery: (...a: unknown[]) => mockBuildQuery(...a) }))
// `isTransportNullReason` comes from the REAL module — it is the rule deciding which
// failures are recoverable, and a stub here would keep passing after that rule changed.
vi.mock('@/lib/services/oracle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/oracle')>()),
  getOracleForecast: (...a: unknown[]) => mockForecast(...a),
  DEFAULT_MAX_ARTICLES: 15,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findUnique: (...a: unknown[]) => mockPredictionFind(...a) } },
}))
vi.mock('@/lib/services/forecast-sources', () => ({ getArticleMetaByUrl: (...a: unknown[]) => mockMeta(...a) }))
vi.mock('@/lib/services/context', () => ({
  saveOracleSnapshotOnly: (...a: unknown[]) => mockSave(...a),
  markOracleAttempted: (...a: unknown[]) => mockMark(...a),
}))
vi.mock('@/lib/services/evidence-pool', () => ({
  addArticlesToPool: (...a: unknown[]) => mockAddToPool(...a),
  claimArticlesForExtraction: (...a: unknown[]) => mockClaim(...a),
  failClaimedArticles: (...a: unknown[]) => mockFailClaimed(...a),
}))
vi.mock('@/lib/services/pooled-estimate', () => ({
  resolvePooledEstimate: (...a: unknown[]) => mockResolvePooled(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { refreshOracleSnapshot, scheduleOracleReask, runOracleReask, REASK_DELAY_MS, _reaskInFlight } from '../oracle-backfill'

const prediction = { id: 'p1', claimText: 'Will X happen?' }

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildQuery.mockResolvedValue('x query')
  mockMeta.mockResolvedValue(new Map())
  mockAddToPool.mockResolvedValue(undefined)
  // Default: the pool can't aggregate, so the estimate is the single run and its own
  // sources — the fallback path. This keeps every test outside the pool block below
  // asserting against the single-run estimate, exactly as before the cutover.
  mockResolvePooled.mockImplementation(async (_id, singleRun, fallbackSources) => ({
    ...singleRun,
    snapshotSources: fallbackSources,
    estimateSource: 'single-run',
    insufficientData: false,
    reason: null,
    poolSize: null,
    singleRunMean: singleRun.mean,
  }))
  // Default: the claim gate always admits the run (existing tests exercise the
  // "something new" path); the skip-when-unchanged path has its own tests below.
  mockClaim.mockResolvedValue(['claimed'])
  mockFailClaimed.mockResolvedValue(undefined)
  mockPredictionFind.mockResolvedValue({ status: 'ACTIVE' })
})

describe('re-ask after a run we hung up on (daatan#1261/#1262)', () => {
  const supplied = [
    { url: 'https://a.com/1', title: 'A', snippet: 'sa' },
    { url: 'https://b.com/2', title: 'B', snippet: 'sb' },
  ]

  /** Let the scheduled re-ask's promise chain settle after the timer fires. */
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Drain anything still pending so `inFlightReasks` — deliberately module state —
    // does not leak a slot into the next test and quietly trip the cap.
    await vi.runAllTimersAsync()
    await settle()
    vi.useRealTimers()
    expect(_reaskInFlight()).toBe(0)
  })

  it('re-asks with the IDENTICAL article set, which is the whole mechanism', async () => {
    // retro keys `forecast_cache` on sha256(question | max_articles | md5(sorted urls) |
    // claim_direction|claim_deadline). Membership of the URL set is therefore load-bearing:
    // a re-ask over a different set is a different key and re-runs the extractor, paying
    // twice to save once. Asserted against what the FIRST call actually sent.
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' })

    const r = await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })
    expect(r).toMatchObject({ status: 'no-oracle', failureClass: 'oracle_timeout' })
    expect(mockForecast).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS)
    await settle()

    expect(mockForecast).toHaveBeenCalledTimes(2)
    const sent = (n: number) =>
      (mockForecast.mock.calls[n][1] as { articles: { url: string }[] }).articles.map((a) => a.url).sort()
    expect(sent(1)).toEqual(sent(0))
    // …and the claim question/metadata that also feed retro's key are unchanged.
    expect(mockForecast.mock.calls[1][0]).toBe(mockForecast.mock.calls[0][0])
  })

  it('does not fire before the delay is up', async () => {
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' })
    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })

    // One millisecond short. The delay has to clear retro's own 90s per-run cap, or the
    // re-ask races a run that has not written to the cache yet.
    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS - 1)
    await settle()
    expect(mockForecast).toHaveBeenCalledTimes(1)
    expect(REASK_DELAY_MS).toBeGreaterThan(90_000)
  })

  it('does NOT re-ask when the Oracle ran and declined', async () => {
    // `oracle_abstain` is a verdict about the articles — the run completed, there is
    // nothing abandoned to collect, and re-asking buys the same answer at full price.
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' })

    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })
    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS)
    await settle()

    expect(mockForecast).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-ask unless the caller opted in', async () => {
    // The admin backfill route calls refreshOracleSnapshot with no opts; it must not
    // acquire a background side effect it never asked for.
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' })

    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry' })
    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS)
    await settle()

    expect(mockForecast).toHaveBeenCalledTimes(1)
  })

  it('a re-ask that times out again does not chain a third', async () => {
    // Depth guard. Without `reask: false` on the inner call, a hard-down Oracle turns
    // every push into an unbounded 2-minute retry chain.
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' })

    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })
    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS * 5)
    await settle()

    expect(mockForecast).toHaveBeenCalledTimes(2)
  })

  it('only re-asks for the subset that was actually SENT', async () => {
    // The extractor only ever saw the claimed articles, so only those are in retro's
    // cache key. Re-asking with the whole batch would miss the entry AND re-extract.
    // Per-article, not a fixed array: the re-ask sends a SHORTER list, and a canned
    // 2-element verdict would silently mis-align with it.
    mockClaim.mockImplementation(async (_id: string, arts: { url: string }[]) =>
      arts.map((a) => (a.url === 'https://a.com/1' ? 'skip' : 'claimed')),
    )
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_network' })

    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })
    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS)
    await settle()

    const urls = (mockForecast.mock.calls[1][1] as { articles: { url: string }[] }).articles.map((a) => a.url)
    expect(urls).toEqual(['https://b.com/2'])
  })

  it('collects the recovered forecast into the pool instead of leaving the row FAILED', async () => {
    // The point of the whole exercise: the second call comes back from `forecast_cache`
    // and the article joins the estimate, rather than the row staying FAILED and the
    // paid extraction being discarded.
    mockForecast
      .mockResolvedValueOnce({ forecast: null, logId: null, failureClass: 'oracle_timeout' })
      .mockResolvedValueOnce({
        forecast: { mean: 0.5, std: 0.1, ci_low: 0.3, ci_high: 0.7, articles_used: 2, sources: [{ url: 'https://a.com/1' }], settled: false },
        logId: 'l1',
      })

    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })
    expect(mockAddToPool).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS)
    await settle()

    expect(mockAddToPool).toHaveBeenCalledTimes(1)
    // The pool row keeps the origin of the push that earned it, not 'backfill'.
    expect(mockAddToPool.mock.calls[0][2]).toBe('retry')
    expect(mockSave).toHaveBeenCalledTimes(1)
  })

  it('skips a forecast that resolved during the delay', async () => {
    // Two minutes is short but not zero, and every other caller of refreshOracleSnapshot
    // filters on ACTIVE upstream. This is the only path with a gap to cover.
    mockPredictionFind.mockResolvedValue({ status: 'RESOLVED' })
    mockForecast.mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' })

    await refreshOracleSnapshot(prediction, { articles: supplied, origin: 'retry', reask: true })
    await vi.advanceTimersByTimeAsync(REASK_DELAY_MS)
    await settle()

    expect(mockForecast).toHaveBeenCalledTimes(1)
  })

  it('drops re-asks past the concurrency cap rather than queueing them', async () => {
    // These are background promises nothing blocks on, so an Oracle that is hard-down
    // would otherwise turn every push into another queued 90s call.
    for (let i = 0; i < 12; i++) {
      scheduleOracleReask({ id: `p${i}`, claimText: 'q' }, supplied, 'news-indexer')
    }
    expect(_reaskInFlight()).toBe(4)
  })

  it('ignores an empty article set — there is no cache key to hit', () => {
    scheduleOracleReask(prediction, [], 'news-indexer')
    expect(_reaskInFlight()).toBe(0)
  })

  it('never throws out of the background path', async () => {
    // It runs detached from any request; an unhandled rejection here would take the
    // process's error budget for a recovery that is best-effort by design.
    mockPredictionFind.mockRejectedValue(new Error('db down'))
    await expect(runOracleReask(prediction, supplied, 'news-indexer')).resolves.toBeUndefined()
  })
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
    expect(r).toEqual({ status: 'no-oracle', failureClass: undefined })
    expect(mockMark).toHaveBeenCalledWith('p1', 'no-oracle')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('surfaces WHY the run produced nothing, not just that it did', async () => {
    // daatan#1253: the class was computed here to stamp the pool rows but thrown away
    // on the way out, so the retry sweep could not tell "the Oracle judged these and
    // declined" from "we hung up" — and retired whole batches on the latter.
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({ forecast: null, failureClass: 'oracle_timeout' })
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'no-oracle', failureClass: 'oracle_timeout' })
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

  describe('the estimate is the whole-pool aggregate, not the single run (cut over from shadow-compare)', () => {
    const forecast = {
      mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1, settled: false,
      sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://a.com/1', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
    }

    it('persists the pool aggregate as the estimate — mean, CI, settled and articlesUsed all from the pool', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })
      mockResolvePooled.mockResolvedValue({
        mean: -0.4, std: 0.3, ciLow: -0.8, ciHigh: 0.0, settled: true, articlesUsed: 7,
        snapshotSources: [
          { sourceName: 'Reuters', url: 'https://reuters.com/x', stance: -0.4 },
          { sourceName: 'AP', url: 'https://ap.com/y', stance: -0.3 },
        ],
        estimateSource: 'pool', poolSize: 9, singleRunMean: 0.2,
      })

      const r = await refreshOracleSnapshot(prediction)

      const saved = mockSave.mock.calls[0][0]
      expect(saved.confidence).toBe(30) // pool -0.4 → 30, NOT the single run's 0.2 → 60
      expect(saved.aiCiLow).toBe(10)
      expect(saved.aiCiHigh).toBe(50)
      expect(saved.settled).toBe(true)
      expect(saved.oracleSnapshot.articlesUsed).toBe(7)
      // sources are the whole pool the aggregate averaged, not the one single-run article
      expect(saved.oracleSnapshot.sources).toHaveLength(2)
      expect(r).toEqual({ status: 'ok', sources: 2 })
    })

    it('pools this run\'s articles BEFORE resolving, so they count toward their own estimate', async () => {
      const order: string[] = []
      mockAddToPool.mockImplementation(async () => { order.push('add') })
      mockResolvePooled.mockImplementation(async (_id, singleRun, fallbackSources) => {
        order.push('resolve')
        return { ...singleRun, snapshotSources: fallbackSources, estimateSource: 'single-run', poolSize: null, singleRunMean: singleRun.mean }
      })
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })

      await refreshOracleSnapshot(prediction)

      expect(mockAddToPool).toHaveBeenCalledWith('p1', expect.any(Array), 'backfill')
      expect(order).toEqual(['add', 'resolve'])
    })

    it('normalizes a prediction with no claimDirection/claimDeadline fields to null (not undefined)', async () => {
      // `prediction` fixture has neither key at all, matching a real Prisma row's
      // nullable columns coming back as `null`, not TS-optional `undefined`.
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })

      await refreshOracleSnapshot(prediction)

      const [, , , claimDirection, claimDeadline] = mockResolvePooled.mock.calls[0]
      expect(claimDirection).toBeNull()
      expect(claimDeadline).toBeNull()
    })

    it('forwards the single run, its sources, a set claimDirection/claimDeadline and the author map to resolvePooledEstimate', async () => {
      const deadline = new Date('2026-12-31T00:00:00.000Z')
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })

      await refreshOracleSnapshot({ ...prediction, claimDirection: 'SURVIVAL', claimDeadline: deadline })

      expect(mockResolvePooled).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ mean: 0.2, articlesUsed: 1, settled: false }),
        expect.any(Array),
        'SURVIVAL',
        deadline,
        expect.any(Map),
        null,
        null,
      )
    })

    it('does not pool or resolve when the Oracle returns no usable forecast', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast: null })

      await refreshOracleSnapshot(prediction)

      expect(mockAddToPool).not.toHaveBeenCalled()
      expect(mockResolvePooled).not.toHaveBeenCalled()
    })

    it('abstains (records insufficientData, no number) when the whole pool is off-topic', async () => {
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast })
      mockResolvePooled.mockResolvedValue({
        mean: 0.2, std: 0.1, ciLow: 0.0, ciHigh: 0.4, settled: false, articlesUsed: 0,
        snapshotSources: [], estimateSource: 'pool-insufficient',
        insufficientData: true, reason: 'all_articles_off_topic', poolSize: 4, singleRunMean: 0.2,
      })

      const r = await refreshOracleSnapshot(prediction)

      expect(r).toEqual({ status: 'insufficient' })
      const saved = mockSave.mock.calls[0][0]
      expect(saved.confidence).toBeNull() // no number persisted
      expect(saved.aiCiLow).toBeNull()
      expect(saved.insufficientData).toBe(true)
      // a non-null oracleSnapshot marker still converges the backfill
      expect(saved.oracleSnapshot).toMatchObject({ insufficient: true, reason: 'all_articles_off_topic' })
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

    it('stamps the specific failure class, not a blanket oracle_null', async () => {
      // daatan#1231. This path is what the RETRY SWEEP runs through, so if it kept
      // writing bare `oracle_null` while the push path wrote classes, the two would
      // disagree about what a pool row means and the sweep would keep manufacturing
      // exactly the rows it exists to drain.
      mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
      mockForecast.mockResolvedValue({ forecast: null, failureClass: 'oracle_timeout' })

      await refreshOracleSnapshot(prediction)

      expect(mockFailClaimed).toHaveBeenCalledWith('p1', ['https://a.com/1'], 'oracle_timeout')
    })

    // The `extractor_error` test that used to sit here is gone with the branch it covered
    // (daatan#1231). It asserted that a throw from `getOracleForecast` released the claim and
    // rethrew — but `getOracleForecast` cannot throw: `getOracleConfig` is a pure env read,
    // every network/parse path is inside its own try, and the catch's only await
    // (`logOracleCall`) swallows its own errors. The test reached the branch solely because
    // the mock could do what the real function cannot. The invariant that makes the catch
    // unnecessary is now pinned directly, in oracle.test.ts → "never rejects".

    it('with supplied articles (retry sweep): skips search, claims and pools under the supplied origin', async () => {
      mockForecast.mockResolvedValue({
        forecast: {
          mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1, settled: false,
          sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://a.com/1', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
        },
      })

      const r = await refreshOracleSnapshot(prediction, {
        articles: [{ url: 'https://a.com/1', title: 't', snippet: '', source: 'a.com' }],
        origin: 'retry',
      })

      expect(r.status).toBe('ok')
      expect(mockSearch).not.toHaveBeenCalled()
      expect(mockBuildQuery).not.toHaveBeenCalled()
      expect(mockClaim).toHaveBeenCalledWith('p1', [expect.objectContaining({ url: 'https://a.com/1' })], 'retry')
      expect(mockAddToPool).toHaveBeenCalledWith('p1', expect.anything(), 'retry')
    })

    it('with supplied articles, an Oracle null releases the claims but writes NO empty marker', async () => {
      mockForecast.mockResolvedValue({ forecast: null })

      const r = await refreshOracleSnapshot(prediction, {
        articles: [{ url: 'https://a.com/1', title: 't', snippet: '' }],
        origin: 'retry',
      })

      expect(r.status).toBe('no-oracle')
      expect(mockFailClaimed).toHaveBeenCalledWith('p1', ['https://a.com/1'], 'oracle_null')
      // markOracleAttempted would write an empty oracleSnapshot marker, which on a
      // forecast with real snapshots becomes the LATEST one every reader trusts.
      expect(mockMark).not.toHaveBeenCalled()
    })

    it('releases claims the Oracle omitted after pooling (FAILED, oracle_omitted), scoped to this run\'s claims', async () => {
      mockSearch.mockResolvedValue([
        { url: 'https://a.com/1', title: 't', snippet: 's' },
        { url: 'https://b.com/2', title: 't2', snippet: 's2' },
      ])
      mockClaim.mockResolvedValue(['skip', 'claimed'])
      mockForecast.mockResolvedValue({
        forecast: {
          mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1, settled: false,
          sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://a.com/1', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
        },
      })

      await refreshOracleSnapshot(prediction)

      // Only the url THIS run claimed — the skipped one belongs to another in-flight run.
      // failClaimedArticles' PENDING filter subtracts what the pool write completed.
      expect(mockFailClaimed).toHaveBeenCalledWith('p1', ['https://b.com/2'], 'oracle_omitted')
    })

    it('only sends newly-claimed articles to the Oracle — an unchanged article must not be re-extracted (daatan#1172)', async () => {
      mockSearch.mockResolvedValue([
        { url: 'https://a.com/1', title: 't', snippet: 's' },
        { url: 'https://b.com/2', title: 't2', snippet: 's2' },
      ])
      mockClaim.mockResolvedValue(['skip', 'claimed'])
      mockForecast.mockResolvedValue({
        forecast: {
          mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1, settled: false,
          sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://b.com/2', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
        },
      })

      await refreshOracleSnapshot(prediction)

      const [, opts] = mockForecast.mock.calls[0]
      expect(opts.articles).toEqual([expect.objectContaining({ url: 'https://b.com/2' })])
    })
  })
})
