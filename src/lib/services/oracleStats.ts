import { prisma } from '@/lib/prisma'
import type { OracleCallStatus, OracleCallType, Prisma } from '@prisma/client'

const RECENT_LIMIT = 50

export interface OracleUsageBreakdown {
  key: string
  callCount: number
  errorCount: number
  avgDurationMs: number | null
  lastSeenAt: Date | null
}

/** Rows from a `groupBy([<dimension>, 'status'])` with count/avg/max selected. */
interface GroupedRow {
  status: OracleCallStatus
  _count: { _all: number }
  _avg: { durationMs: number | null }
  _max: { createdAt: Date | null }
}

/** Fold `[dimension, status]` groups into one row per dimension key. */
function fold<T extends GroupedRow>(rows: T[], keyOf: (r: T) => string): OracleUsageBreakdown[] {
  const map = new Map<string, { callCount: number; errorCount: number; durSum: number; durN: number; lastSeen: Date | null }>()
  for (const r of rows) {
    const k = keyOf(r)
    const e = map.get(k) ?? { callCount: 0, errorCount: 0, durSum: 0, durN: 0, lastSeen: null }
    e.callCount += r._count._all
    if (r.status === 'ERROR') e.errorCount += r._count._all
    if (r._avg.durationMs != null) {
      e.durSum += r._avg.durationMs * r._count._all
      e.durN += r._count._all
    }
    if (r._max.createdAt && (!e.lastSeen || r._max.createdAt > e.lastSeen)) e.lastSeen = r._max.createdAt
    map.set(k, e)
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      callCount: v.callCount,
      errorCount: v.errorCount,
      avgDurationMs: v.durN > 0 ? Math.round(v.durSum / v.durN) : null,
      lastSeenAt: v.lastSeen,
    }))
    .sort((a, b) => b.callCount - a.callCount)
}

/**
 * Aggregate Oracle call usage over the given window for the admin stats view:
 * breakdowns by source / call type / search engine / status, plus totals and
 * the most recent calls.
 */
export async function getOracleUsageStats(
  windowDays = 30,
  filters?: { source?: string; callType?: OracleCallType; status?: OracleCallStatus },
) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const where: Prisma.OracleCallLogWhereInput = { createdAt: { gte: since } }
  if (filters?.source) where.source = filters.source
  if (filters?.callType) where.callType = filters.callType
  if (filters?.status) where.status = filters.status

  const [bySourceRows, byTypeRows, byEngineRows, byStatusRows, byReasonRows, totalsRows, fallbackAgg, extremeFallbackCount, recent] = await Promise.all([
    prisma.oracleCallLog.groupBy({ by: ['source', 'status'], where, _count: { _all: true }, _avg: { durationMs: true }, _max: { createdAt: true } }),
    prisma.oracleCallLog.groupBy({ by: ['callType', 'status'], where, _count: { _all: true }, _avg: { durationMs: true }, _max: { createdAt: true } }),
    prisma.oracleCallLog.groupBy({ by: ['searchEngine', 'status'], where, _count: { _all: true }, _avg: { durationMs: true }, _max: { createdAt: true } }),
    prisma.oracleCallLog.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.oracleCallLog.groupBy({ by: ['failureReason'], where: { ...where, NOT: { failureReason: null } }, _count: { _all: true } }),
    prisma.oracleCallLog.aggregate({ where, _count: { _all: true }, _avg: { durationMs: true } }),
    prisma.oracleCallLog.aggregate({ where: { ...where, fellBackToLlm: true }, _count: { _all: true }, _avg: { fallbackProbability: true } }),
    prisma.oracleCallLog.count({ where: { ...where, fellBackToLlm: true, OR: [{ fallbackProbability: { gt: 85 } }, { fallbackProbability: { lt: 10 } }] } }),
    prisma.oracleCallLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: RECENT_LIMIT,
      select: {
        id: true, callType: true, source: true, status: true, httpStatus: true,
        searchEngine: true, provider: true, providerChain: true, query: true,
        resultCount: true, durationMs: true, createdAt: true,
        failureReason: true, fellBackToLlm: true, fallbackProbability: true,
        user: { select: { id: true, name: true, username: true } },
        prediction: { select: { id: true, slug: true, claimText: true } },
      },
    }),
  ])

  const totalCalls = totalsRows._count._all
  const errorCalls = byStatusRows.find(r => r.status === 'ERROR')?._count._all ?? 0

  // Fallback rate is measured against FORECAST calls — the only call type that falls back.
  const byCallType = fold(byTypeRows, r => r.callType)
  const forecastCalls = byCallType.find(r => r.key === 'FORECAST')?.callCount ?? 0
  const fallbackCount = fallbackAgg._count._all

  return {
    windowDays,
    totals: {
      totalCalls,
      errorCalls,
      errorRate: totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 100) : 0,
      avgDurationMs: totalsRows._avg.durationMs != null ? Math.round(totalsRows._avg.durationMs) : null,
    },
    bySource: fold(bySourceRows, r => r.source),
    byCallType,
    byEngine: fold(byEngineRows, r => r.searchEngine ?? '—'),
    byStatus: byStatusRows.map(r => ({ key: r.status, callCount: r._count._all })),
    byFailureReason: byReasonRows
      .map(r => ({ key: r.failureReason ?? 'unknown', callCount: r._count._all }))
      .sort((a, b) => b.callCount - a.callCount),
    fallback: {
      count: fallbackCount,
      rate: forecastCalls > 0 ? Math.round((fallbackCount / forecastCalls) * 100) : 0,
      avgProbability: fallbackAgg._avg.fallbackProbability != null ? Math.round(fallbackAgg._avg.fallbackProbability) : null,
      extremeCount: extremeFallbackCount,
    },
    recent,
  }
}
