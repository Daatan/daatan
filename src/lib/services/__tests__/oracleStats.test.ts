/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oracleCallLog: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { getOracleUsageStats } from '../oracleStats'
import { prisma } from '@/lib/prisma'

const mockGroupBy = vi.mocked(prisma.oracleCallLog.groupBy)
const mockAggregate = vi.mocked(prisma.oracleCallLog.aggregate)
const mockCount = vi.mocked(prisma.oracleCallLog.count)
const mockFindMany = vi.mocked(prisma.oracleCallLog.findMany)

const d = (s: string) => new Date(s)

beforeEach(() => {
  vi.clearAllMocks()
  // groupBy is called in order: bySource, byCallType, byEngine, byStatus, byFailureReason
  mockGroupBy
    .mockResolvedValueOnce([
      { source: 'bot-voting', status: 'OK', _count: { _all: 3 }, _avg: { durationMs: 100 }, _max: { createdAt: d('2026-06-01') } },
      { source: 'bot-voting', status: 'ERROR', _count: { _all: 1 }, _avg: { durationMs: 50 }, _max: { createdAt: d('2026-06-02') } },
      { source: 'research', status: 'OK', _count: { _all: 2 }, _avg: { durationMs: 200 }, _max: { createdAt: d('2026-06-03') } },
    ] as never)
    .mockResolvedValueOnce([
      { callType: 'FORECAST', status: 'OK', _count: { _all: 5 }, _avg: { durationMs: 120 }, _max: { createdAt: d('2026-06-03') } },
    ] as never)
    .mockResolvedValueOnce([
      { searchEngine: 'gdelt', status: 'OK', _count: { _all: 4 }, _avg: { durationMs: 110 }, _max: { createdAt: d('2026-06-03') } },
      { searchEngine: null, status: 'OK', _count: { _all: 2 }, _avg: { durationMs: 90 }, _max: { createdAt: d('2026-06-01') } },
    ] as never)
    .mockResolvedValueOnce([
      { status: 'OK', _count: { _all: 6 } },
      { status: 'ERROR', _count: { _all: 1 } },
    ] as never)
    .mockResolvedValueOnce([
      { failureReason: 'timeout', _count: { _all: 3 } },
      { failureReason: 'all_articles_off_topic', _count: { _all: 1 } },
    ] as never)
  // aggregate is called in order: totals, fallback
  mockAggregate
    .mockResolvedValueOnce({ _count: { _all: 7 }, _avg: { durationMs: 130 } } as never)
    .mockResolvedValueOnce({ _count: { _all: 2 }, _avg: { fallbackProbability: 91 } } as never)
  mockCount.mockResolvedValue(1 as never)
  mockFindMany.mockResolvedValue([
    { id: 'c1', callType: 'FORECAST', source: 'context-update', status: 'OK', durationMs: 300, createdAt: d('2026-06-03'), user: { name: 'A', username: 'a' } },
  ] as never)
})

describe('getOracleUsageStats', () => {
  it('computes totals from the status + aggregate rows', async () => {
    const stats = await getOracleUsageStats(7)
    expect(stats.windowDays).toBe(7)
    expect(stats.totals.totalCalls).toBe(7)
    expect(stats.totals.errorCalls).toBe(1)
    expect(stats.totals.errorRate).toBe(14) // round(1/7*100)
    expect(stats.totals.avgDurationMs).toBe(130)
  })

  it('folds [dimension, status] groups into per-key breakdowns, sorted by call count', async () => {
    const stats = await getOracleUsageStats()
    // bot-voting: 3 OK + 1 ERROR = 4 calls, 1 error, weighted avg (100*3 + 50*1)/4 = 87.5 -> 88
    expect(stats.bySource[0]).toEqual({
      key: 'bot-voting', callCount: 4, errorCount: 1, avgDurationMs: 88, lastSeenAt: d('2026-06-02'),
    })
    expect(stats.bySource[1].key).toBe('research')
    expect(stats.bySource[1].errorCount).toBe(0)
  })

  it('renders a null search engine as the "—" bucket', async () => {
    const stats = await getOracleUsageStats()
    expect(stats.byEngine.map(b => b.key)).toContain('—')
    expect(stats.byEngine.map(b => b.key)).toContain('gdelt')
  })

  it('builds the failure-reason breakdown sorted by count', async () => {
    const stats = await getOracleUsageStats()
    expect(stats.byFailureReason).toEqual([
      { key: 'timeout', callCount: 3 },
      { key: 'all_articles_off_topic', callCount: 1 },
    ])
  })

  it('summarises fallback against FORECAST calls', async () => {
    const stats = await getOracleUsageStats()
    // 2 fallbacks / 5 FORECAST calls = 40%; avg 91; 1 extreme (from count mock)
    expect(stats.fallback).toEqual({ count: 2, rate: 40, avgProbability: 91, extremeCount: 1 })
  })

  it('returns the recent calls with their attributed user', async () => {
    const stats = await getOracleUsageStats()
    expect(stats.recent).toHaveLength(1)
    expect(stats.recent[0].user).toEqual({ name: 'A', username: 'a' })
  })

  it('applies source, callType and status filters to every query where-clause', async () => {
    await getOracleUsageStats(7, { source: 'bot-voting', callType: 'FORECAST', status: 'ERROR' })
    const expected = { source: 'bot-voting', callType: 'FORECAST', status: 'ERROR' }
    expect(mockFindMany.mock.calls[0]?.[0]?.where).toMatchObject(expected)
    expect(mockGroupBy.mock.calls[0]?.[0]?.where).toMatchObject(expected)
    expect(mockAggregate.mock.calls[0]?.[0]?.where).toMatchObject(expected)
  })

  it('omits source/callType/status from the where-clause when no filters are given', async () => {
    await getOracleUsageStats(7)
    const where = mockFindMany.mock.calls[0]?.[0]?.where
    expect(where?.source).toBeUndefined()
    expect(where?.callType).toBeUndefined()
    expect(where?.status).toBeUndefined()
  })
})
