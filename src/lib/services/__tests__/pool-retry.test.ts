import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    prediction: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/services/oracle-backfill', () => ({
  refreshOracleSnapshot: (...a: unknown[]) => mockRefresh(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { retryPoolExtractions } from '../pool-retry'

const mockGroupBy = vi.mocked(prisma.evidencePoolArticle.groupBy)
const mockRows = vi.mocked(prisma.evidencePoolArticle.findMany)
const mockCount = vi.mocked(prisma.evidencePoolArticle.count)
const mockUpdateMany = vi.mocked(prisma.evidencePoolArticle.updateMany)
const mockPredictions = vi.mocked(prisma.prediction.findMany)

function row(over: Record<string, unknown> = {}) {
  return {
    url: 'https://a.com/1',
    title: 'Stuck headline',
    snippet: null,
    source: 'a.com',
    publishedDate: '2026-07-09',
    statusReason: null,
    ...over,
  }
}

describe('retryPoolExtractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 1 })
    mockRows.mockResolvedValue([row()] as never)
    mockCount.mockResolvedValue(0)
    mockUpdateMany.mockResolvedValue({ count: 0 } as never)
  })

  it('sweeps the biggest ACTIVE-forecast backlogs first, up to the limit', async () => {
    mockGroupBy.mockResolvedValue([
      { predictionId: 'small', _count: { _all: 2 } },
      { predictionId: 'big', _count: { _all: 40 } },
      { predictionId: 'mid', _count: { _all: 10 } },
    ] as never)
    mockPredictions.mockResolvedValue([
      { id: 'small', claimText: 's', claimDirection: null, claimDeadline: null },
      { id: 'big', claimText: 'b', claimDirection: null, claimDeadline: null },
      { id: 'mid', claimText: 'm', claimDirection: null, claimDeadline: null },
    ] as never)

    const r = await retryPoolExtractions(2)

    expect(r.processed).toBe(2)
    expect(mockRefresh.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['big', 'mid'])
    // Only ACTIVE predictions were even considered
    const predWhere = mockPredictions.mock.calls[0][0] as { where: { status: string } }
    expect(predWhere.where.status).toBe('ACTIVE')
  })

  it('re-pushes the snippet the original attempt carried, not title-only', async () => {
    // daatan#1232. This hard-coded `snippet: ''`, so the retry sent strictly LESS text than
    // the attempt that already failed. For a Telegram row whose only content IS the
    // snippet, the second null was near-deterministic — which means the `oracle_null_final`
    // stamp that follows it was a self-fulfilling prophecy, not a genuine re-test.
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRows.mockResolvedValue([row({ snippet: 'Sharren Haskel resigned as Deputy FM.' })] as never)
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 1 })

    await retryPoolExtractions(3)

    expect(mockRefresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        articles: [expect.objectContaining({ snippet: 'Sharren Haskel resigned as Deputy FM.' })],
      }),
    )
  })

  it('still falls back to title-only for rows pooled before the snippet column existed', async () => {
    // No backfill is possible — the snippet was never persisted on this side. Those rows
    // must keep working exactly as before rather than erroring or being skipped.
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRows.mockResolvedValue([row({ snippet: null })] as never)
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 1 })

    await retryPoolExtractions(3)

    expect(mockRefresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ articles: [expect.objectContaining({ snippet: '' })] }),
    )
  })

  it('re-drives rows as title-only articles under origin retry', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'Will X happen?', claimDirection: 'YES', claimDeadline: null },
    ] as never)

    await retryPoolExtractions(3)

    expect(mockRefresh).toHaveBeenCalledWith(
      { id: 'p1', claimText: 'Will X happen?', claimDirection: 'YES', claimDeadline: null },
      {
        articles: [
          // The pool never stored the snippet — retried articles carry title only.
          { url: 'https://a.com/1', title: 'Stuck headline', snippet: '', source: 'a.com', publishedDate: '2026-07-09' },
        ],
        origin: 'retry',
        // The sweep pays for a full extraction per batch and discards it on a client
        // timeout exactly as the push path does, and nothing waits on its response —
        // so it opts into the re-ask too (daatan#1262).
        reask: true,
      },
    )
  })

  it('excludes the terminal reasons — judged-irrelevant and twice-null rows never retry', async () => {
    mockGroupBy.mockResolvedValue([] as never)
    mockPredictions.mockResolvedValue([] as never)

    await retryPoolExtractions(3)

    const where = (mockGroupBy.mock.calls[0][0] as { where: { OR: unknown[] } }).where
    expect(where).toMatchObject({ excluded: false, title: { not: null } })
    expect(where.OR).toEqual([
      { status: 'FAILED', statusReason: null },
      { status: 'FAILED', statusReason: { notIn: ['oracle_omitted', 'oracle_null_final', 'retired_legacy', 'stale_published_date'] } },
      { status: 'PENDING' },
    ])
  })

  describe('second-strike rule (attempt cap)', () => {
    beforeEach(() => {
      mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 2 } }] as never)
      mockPredictions.mockResolvedValue([
        { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
      ] as never)
      mockRows.mockResolvedValue([
        row({ url: 'https://a.com/1', statusReason: 'oracle_abstain' }),
        row({ url: 'https://b.com/2', statusReason: 'extractor_error' }),
      ] as never)
    })

    it('finalizes rows already declined by the Oracle when it declines again', async () => {
      mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass: 'oracle_abstain' })
      mockUpdateMany.mockResolvedValue({ count: 1 } as never)

      const r = await retryPoolExtractions(3)

      expect(mockUpdateMany).toHaveBeenCalledWith({
        // Only the prior-abstain row; the extractor_error row keeps its first strike.
        where: {
          predictionId: 'p1',
          url: { in: ['https://a.com/1'] },
          status: 'FAILED',
          statusReason: { in: expect.arrayContaining(['oracle_abstain']) },
        },
        data: { statusReason: 'oracle_null_final' },
      })
      expect(r.finalized).toBe(1)
    })

    it.each(['oracle_abstain', 'oracle_no_articles'])(
      'finalizes a prior-%s row — the daatan#1231 split must not disarm the attempt cap',
      async (reason) => {
        // The silent break daatan#1231 could have shipped. This rule used to match the
        // literal `'oracle_null'`; once that string was split per cause, a strict-equality
        // check would stop recognising every newly-written row — no second strike, no
        // `oracle_null_final`, and the daily sweep re-driving dead articles forever. The
        // failure mode is invisible: nothing errors, the backlog just never drains. These
        // two are the post-split strings that still MUST arm it.
        mockRows.mockResolvedValue([row({ url: 'https://a.com/1', statusReason: reason })] as never)
        mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass: 'oracle_abstain' })
        mockUpdateMany.mockResolvedValue({ count: 1 } as never)

        const r = await retryPoolExtractions(3)

        expect(mockUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ url: { in: ['https://a.com/1'] } }),
            data: { statusReason: 'oracle_null_final' },
          }),
        )
        expect(r.finalized).toBe(1)
      },
    )

    it.each(['oracle_timeout', 'oracle_network', 'oracle_http', 'oracle_unconfigured', 'oracle_placeholder', 'oracle_null'])(
      'does NOT count a prior %s as a strike — that null was about the wire, not the article',
      async (reason) => {
        // daatan#1253. Strike one has to be a verdict. A row whose first null was a 12s
        // client timeout has been judged once, not twice. `oracle_null` is here because
        // it is the pre-split string that conflates all six causes — unknown, not
        // attributable.
        mockRows.mockResolvedValue([row({ url: 'https://a.com/1', statusReason: reason })] as never)
        mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass: 'oracle_abstain' })

        const r = await retryPoolExtractions(3)

        expect(mockUpdateMany).not.toHaveBeenCalled()
        expect(r.finalized).toBe(0)
      },
    )

    it.each(['oracle_timeout', 'oracle_network', 'oracle_http', 'oracle_unconfigured', 'oracle_placeholder'])(
      'does NOT finalize when THIS run failed with %s, however many prior strikes',
      async (failureClass) => {
        // The headline bug (daatan#1253): one Oracle call carries up to
        // DEFAULT_MAX_ARTICLES rows, so a single client timeout used to stamp the whole
        // batch terminal on zero information about any article in it. 94.9% of terminal
        // rows were retired in multi-row groups; 24% of the calls behind them were
        // client-side errors at exactly 12,001 ms.
        mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass })

        const r = await retryPoolExtractions(3)

        expect(mockUpdateMany).not.toHaveBeenCalled()
        expect(r.finalized).toBe(0)
      },
    )

    it('spares a whole batch when one timeout would otherwise have retired all of it', async () => {
      // The measured shape, in miniature: every row in the batch has an attributable
      // first strike, so pre-fix all 15 would be stamped terminal by a single timeout.
      const batch = Array.from({ length: 15 }, (_, i) =>
        row({ url: `https://a.com/${i}`, statusReason: 'oracle_abstain' }),
      )
      mockRows.mockResolvedValue(batch as never)
      mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass: 'oracle_timeout' })

      const r = await retryPoolExtractions(3)

      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(r.finalized).toBe(0)
      // Still counted as a null run — the sweep's own accounting is unchanged.
      expect(r.noOracle).toBe(1)
    })

    it('does not finalize when the run reports no failure class at all', async () => {
      // Unknown is not attributable. Retiring on a missing class would reintroduce the
      // bug for any path that forgets to thread it through.
      mockRefresh.mockResolvedValue({ status: 'no-oracle' })

      const r = await retryPoolExtractions(3)

      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(r.finalized).toBe(0)
    })

    it('still ignores reasons outside the null family', async () => {
      // `oracle_omitted` is the gatekeeper saying "irrelevant" — a verdict, not a null
      // run — and must never be swept up by the match.
      mockRows.mockResolvedValue([row({ url: 'https://d.com/4', statusReason: 'oracle_omitted' })] as never)
      mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass: 'oracle_abstain' })

      const r = await retryPoolExtractions(3)

      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(r.finalized).toBe(0)
    })

    it('does not finalize anything when the run succeeds', async () => {
      mockRefresh.mockResolvedValue({ status: 'ok', sources: 2 })

      const r = await retryPoolExtractions(3)

      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(r.finalized).toBe(0)
    })

    it('does not finalize first-strike rows on a null run', async () => {
      mockRows.mockResolvedValue([row({ url: 'https://c.com/3', statusReason: null })] as never)
      mockRefresh.mockResolvedValue({ status: 'no-oracle', failureClass: 'oracle_abstain' })

      const r = await retryPoolExtractions(3)

      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(r.finalized).toBe(0)
    })
  })

  it('tallies outcomes per prediction and reports the remaining backlog', async () => {
    mockGroupBy.mockResolvedValue([
      { predictionId: 'p1', _count: { _all: 3 } },
      { predictionId: 'p2', _count: { _all: 2 } },
      { predictionId: 'p3', _count: { _all: 1 } },
    ] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
      { id: 'p2', claimText: 'b', claimDirection: null, claimDeadline: null },
      { id: 'p3', claimText: 'c', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRefresh
      .mockResolvedValueOnce({ status: 'ok', sources: 2 })
      .mockResolvedValueOnce({ status: 'no-oracle' })
      .mockRejectedValueOnce(new Error('boom'))
    mockCount.mockResolvedValue(4)

    const r = await retryPoolExtractions(5)

    expect(r).toMatchObject({ processed: 3, ok: 1, noOracle: 1, failed: 1, remaining: 4 })
  })

  it('skips a prediction whose retryable rows all lack a title', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRows.mockResolvedValue([row({ title: null })] as never)

    const r = await retryPoolExtractions(3)

    expect(r.processed).toBe(0)
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
