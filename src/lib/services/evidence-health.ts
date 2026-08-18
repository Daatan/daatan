import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { EvidenceHealthIssue } from '@/lib/services/telegram'

const log = createLogger('evidence-health')

/**
 * Fail-loud health check for the evidence pipeline (daatan#1478).
 *
 * The pipeline had no alerting at all: `evidence-pool.ts` writes
 * `{status:'FAILED', statusReason}` with a `log.warn` and imports nothing from
 * telegram.ts, `fetchOracleSources` discards `Promise.allSettled` rejections, and
 * `/api/cron/evidence-pool-stats` computes throughput for the weekly waste report
 * and alerts on nothing. Every evidence-quality bug in the backlog was therefore
 * found by a human going and looking — including a source that had been silent for
 * six days while `/stats` still called it healthy (ni#304).
 *
 * ## Why this alerts on DELTA, not on an absolute rate
 *
 * 47.2% of all pool rows are FAILED (7,809/16,530, measured 2026-08-18), and that
 * is not in itself a fault: a wide net is *supposed* to discard a lot — off-topic
 * articles, paywalls, opinion with no extractable claim. An absolute threshold set
 * anywhere near today's rate either fires permanently or never fires at all. What
 * carries information is a source departing from *its own* recent behaviour, so
 * every check here compares a recent window against a longer baseline window and
 * fires on the gap between them. #1476 (splitting "correctly dropped" from
 * "evidence lost") refines these thresholds later; it does not gate them.
 *
 * ## Known interaction with the retry sweep
 *
 * `claimArticleForExtraction` supersedes a row and inserts a replacement with a
 * fresh `addedAt`, so Monday's `retry-pool-extractions.yml` sweep migrates rows
 * from the baseline window into the recent one. The recent window is 7 days —
 * exactly one sweep — so the effect is present in every comparison rather than in
 * some of them, and it biases the recent failure rate *down* (a retry that
 * succeeds), i.e. toward silence rather than toward a false page.
 */

/** Recent window: one full weekly retry sweep, so the sweep's churn is always in it. */
export const RECENT_DAYS = 7
/** Baseline window: the 28 days before the recent window (never overlapping it). */
export const BASELINE_DAYS = 28

/**
 * Per-source volume guards. Measured over the 28d baseline on prod (2026-08-18):
 * 26 sources have >= 100 rows and carry 85% of all volume, 26 more have 30-99, and
 * the remaining 83 have under 30 between them. A rate computed on fewer than 30
 * baseline rows moves double digits on a single article, so it can only produce
 * noise; the >= 30 cut keeps 52 sources covering ~97% of volume.
 */
const MIN_BASELINE_ROWS = 30
/** Same argument for the other side of the comparison. */
const MIN_RECENT_ROWS = 20

/**
 * Percentage points of *worsening* against the source's own baseline. Sampled over
 * the live per-source table, +20pp picks out exactly one source (hnaftali.com,
 * 37% -> 80%) and leaves the ordinary +-15pp drift of every other source alone.
 * Deliberately one-directional: a source that gets *better* is not an incident.
 */
const SOURCE_FAILURE_DELTA_PP = 20

/** The overall share is a much larger sample, so it needs a tighter band. */
const OVERALL_FAILURE_DELTA_PP = 15
const MIN_OVERALL_RECENT_ROWS = 100
const MIN_OVERALL_BASELINE_ROWS = 300

/**
 * Recent rows/day below this fraction of the baseline rate. Prod runs at 277/day
 * recent vs 487/day baseline (ratio 0.57) purely from how many forecasts are live,
 * so the trigger sits well under that: this is meant to catch ingestion stopping,
 * not to track demand.
 */
const VOLUME_COLLAPSE_RATIO = 0.35

/** Alert keys are VarChar(200); `source` is VarChar(200) on its own. */
const MAX_KEY_SOURCE_LEN = 150

interface Counts {
  total: number
  failed: number
}

interface WindowStats extends Counts {
  /** Null-`source` rows are counted in the totals but can't be attributed to anyone. */
  bySource: Map<string, Counts>
}

export interface EvidenceHealthResult {
  /** Conditions that fired on THIS run — the only ones worth a message. */
  fired: EvidenceHealthIssue[]
  /** Conditions still true but already alerted on an earlier run. */
  suppressed: number
  recentRows: number
  recentFailedPct: number | null
  baselineFailedPct: number | null
}

function failedPct(c: Counts): number | null {
  return c.total === 0 ? null : Math.round((100 * c.failed) / c.total)
}

async function windowStats(from: Date, to: Date | null): Promise<WindowStats> {
  const groups = await prisma.evidencePoolArticle.groupBy({
    by: ['source', 'status'],
    where: {
      supersededAt: null,
      addedAt: to ? { gt: from, lte: to } : { gt: from },
    },
    _count: { _all: true },
  })

  const stats: WindowStats = { total: 0, failed: 0, bySource: new Map() }
  for (const g of groups) {
    const n = g._count._all
    const isFailed = g.status === 'FAILED'
    stats.total += n
    if (isFailed) stats.failed += n
    if (g.source === null) continue
    const entry = stats.bySource.get(g.source) ?? { total: 0, failed: 0 }
    entry.total += n
    if (isFailed) entry.failed += n
    stats.bySource.set(g.source, entry)
  }
  return stats
}

/**
 * ACTIVE forecasts whose pool holds nothing aggregation can read (daatan#1475).
 *
 * "COMPLETE" alone is not the bar: `recomputeFromPool` needs a stance, so a
 * COMPLETE row without one is indistinguishable from a failure downstream — the
 * same definition `getPoolThroughput`'s `usable` uses.
 */
async function forecastsWithoutEvidence(): Promise<EvidenceHealthIssue[]> {
  const active = await prisma.prediction.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, claimText: true, slug: true },
  })
  if (active.length === 0) return []

  const withEvidence = await prisma.evidencePoolArticle.groupBy({
    by: ['predictionId'],
    where: {
      predictionId: { in: active.map((p) => p.id) },
      status: 'COMPLETE',
      stance: { not: null },
      supersededAt: null,
    },
    _count: { _all: true },
  })

  const covered = new Set(withEvidence.map((g) => g.predictionId))
  return active
    .filter((p) => !covered.has(p.id))
    .map((p) => ({
      kind: 'forecast_no_evidence' as const,
      predictionId: p.id,
      claimText: p.claimText,
      slug: p.slug,
    }))
}

export function alertKey(issue: EvidenceHealthIssue): string {
  switch (issue.kind) {
    case 'source_failure_rate':
      return `source-failure:${issue.source.slice(0, MAX_KEY_SOURCE_LEN)}`
    case 'source_silent':
      return `source-silent:${issue.source.slice(0, MAX_KEY_SOURCE_LEN)}`
    case 'forecast_no_evidence':
      return `forecast-empty:${issue.predictionId}`
    case 'overall_failure_rate':
      return 'overall-failure'
    case 'overall_volume_collapse':
      return 'overall-volume'
  }
}

/**
 * Claim the conditions nobody has alerted on yet, and release the ones that no
 * longer hold. Returns the keys this run actually claimed.
 *
 * The insert is the claim: `createMany({skipDuplicates})` reports how many rows it
 * wrote, so only the run that actually created the row notifies and an overlapping
 * run (a retry, a manual dispatch) can't page twice for the same condition — the
 * `updateMany`-gated-on-null idiom from `checkMarketDivergence`, with the row
 * created rather than updated because a source has no row of its own.
 *
 * Deleting the keys that dropped out of the active set is what re-arms them: a
 * source that goes silent, comes back, and goes silent again alerts twice.
 */
async function reconcileAlerts(activeKeys: string[]): Promise<Set<string>> {
  const active = new Set(activeKeys)
  const existing = new Set(
    (await prisma.evidenceHealthAlert.findMany({ select: { key: true } })).map((r) => r.key),
  )

  const claimed = new Set<string>()
  for (const key of active) {
    if (existing.has(key)) continue
    const { count } = await prisma.evidenceHealthAlert.createMany({
      data: [{ key }],
      skipDuplicates: true,
    })
    if (count > 0) claimed.add(key)
  }

  const stale = [...existing].filter((k) => !active.has(k))
  if (stale.length > 0) {
    await prisma.evidenceHealthAlert.deleteMany({ where: { key: { in: stale } } })
  }

  return claimed
}

/**
 * Evaluate every check, reconcile the fire/re-arm state, and return what is newly
 * broken. Throws on a query failure rather than reporting a clean run — a health
 * check that reports zero issues because it couldn't read the data is worse than
 * no health check, and a half-computed run would also release live alerts.
 */
export async function checkEvidenceHealth(now: Date = new Date()): Promise<EvidenceHealthResult> {
  const recentFrom = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000)
  const baselineFrom = new Date(recentFrom.getTime() - BASELINE_DAYS * 24 * 60 * 60 * 1000)

  const [recent, baseline, emptyForecasts] = await Promise.all([
    windowStats(recentFrom, null),
    windowStats(baselineFrom, recentFrom),
    forecastsWithoutEvidence(),
  ])

  const issues: EvidenceHealthIssue[] = []

  const recentPerDay = recent.total / RECENT_DAYS
  const baselinePerDay = baseline.total / BASELINE_DAYS
  const volumeCollapsed =
    baseline.total >= MIN_OVERALL_BASELINE_ROWS && recentPerDay < baselinePerDay * VOLUME_COLLAPSE_RATIO
  if (volumeCollapsed) {
    issues.push({
      kind: 'overall_volume_collapse',
      recentPerDay: Math.round(recentPerDay),
      baselinePerDay: Math.round(baselinePerDay),
    })
  }

  const recentPct = failedPct(recent)
  const baselinePct = failedPct(baseline)
  if (
    recent.total >= MIN_OVERALL_RECENT_ROWS &&
    baseline.total >= MIN_OVERALL_BASELINE_ROWS &&
    recentPct !== null &&
    baselinePct !== null &&
    recentPct - baselinePct >= OVERALL_FAILURE_DELTA_PP
  ) {
    issues.push({ kind: 'overall_failure_rate', recentPct, baselinePct })
  }

  for (const [source, base] of baseline.bySource) {
    if (base.total < MIN_BASELINE_ROWS) continue
    const rec = recent.bySource.get(source) ?? { total: 0, failed: 0 }

    if (rec.total === 0) {
      // "while its siblings keep flowing" made literal: when ingestion as a whole
      // has stopped, every source looks silent, and one overall alert says more
      // than fifty per-source ones.
      if (!volumeCollapsed) {
        issues.push({ kind: 'source_silent', source, baselineRows: base.total })
      }
      continue
    }

    if (rec.total < MIN_RECENT_ROWS) continue
    const rPct = failedPct(rec)
    const bPct = failedPct(base)
    if (rPct !== null && bPct !== null && rPct - bPct >= SOURCE_FAILURE_DELTA_PP) {
      issues.push({
        kind: 'source_failure_rate',
        source,
        recentPct: rPct,
        baselinePct: bPct,
        recentRows: rec.total,
      })
    }
  }

  issues.push(...emptyForecasts)

  const claimed = await reconcileAlerts(issues.map(alertKey))
  const fired = issues.filter((i) => claimed.has(alertKey(i)))

  log.info(
    {
      recent_rows: recent.total,
      recent_failed_pct: recentPct,
      baseline_rows: baseline.total,
      baseline_failed_pct: baselinePct,
      active: issues.length,
      fired: fired.length,
    },
    'event=evidence_health_check',
  )

  return {
    fired,
    suppressed: issues.length - fired.length,
    recentRows: recent.total,
    recentFailedPct: recentPct,
    baselineFailedPct: baselinePct,
  }
}
