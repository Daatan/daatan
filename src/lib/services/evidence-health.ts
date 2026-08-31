import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { EvidenceHealthIssue } from '@/lib/services/telegram'
import { USABLE_POOL_ROW_WHERE } from '@/lib/services/evidence-pool'

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

/**
 * How far back the panel-402 check looks (daatan#1504). The digest runs daily, so
 * "since the last run" is 24h plus slack for cron drift; a burst is "active" while
 * its last 402 is inside this window and re-arms once it ages out. All four
 * OpenRouter panel members fail together on credit exhaustion, so any 402s at all
 * ≈ total panel outage — no threshold beyond "any".
 */
export const PANEL_402_LOOKBACK_HOURS = 26

/** Alert keys are VarChar(200); `source` is VarChar(200) on its own. */
const MAX_KEY_SOURCE_LEN = 150

/**
 * TruthMachine batch-loop liveness (retro#556).
 *
 * The batch tree on the Oracul box ran stale code twice (six weeks once) with
 * zero detection; retro PR#555 makes a failed sync refuse the cycle, but that is
 * only visible in `pipeline_log.txt` on the box. The loop's one externally
 * visible heartbeat is the `atlas:` / `progress:` commits it pushes to
 * `Daatan/retro` `main` — every batch touches `data/progress.json`, and nothing
 * else ever commits that path. "Newest commit touching that path is too old" is
 * therefore the outermost liveness signal: it catches a crashed loop, a wedged
 * `.git/index.lock`, and PR#555's stale-code refusal (which stops commits
 * entirely) alike. retro itself has no alerting surface, which is why the check
 * lives here.
 */
export const BATCH_HEARTBEAT_REPO = 'Daatan/retro'
export const BATCH_HEARTBEAT_PATH = 'data/progress.json'
/**
 * A healthy loop commits every few minutes (measured 2026-08-20: 30 commits in
 * ~35 min), so any hours-scale threshold is >100× the normal gap; the binding
 * constraint is instead this check's own daily sampling. 12h keeps ordinary
 * quiet stretches (API-quota pauses, empty ingest batches) far below the bar
 * while still flagging a dead loop on the next daily run — worst case ~36h
 * after death, against the 2 days and 6 weeks the last two incidents lasted.
 */
export const BATCH_HEARTBEAT_STALE_HOURS = 12
const BATCH_HEARTBEAT_TIMEOUT_MS = 10_000

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
 * "COMPLETE" alone is not the bar, and neither is COMPLETE-with-a-stance, which is what
 * this check originally asked for: `/pool/aggregate` also needs certainty, credibility
 * weight and relevance, and drops excluded rows. A forecast could therefore clear this
 * alert and still aggregate to nothing — the alert would stay silent on exactly the
 * forecasts it exists to catch. It now shares `isUsablePoolRow`'s definition with the
 * aggregate and the forecast page's guard (`USABLE_POOL_ROW_WHERE`), so the three cannot
 * drift apart.
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
      ...USABLE_POOL_ROW_WHERE,
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

/**
 * AI-panel 402 burst since the last digest run (daatan#1504, decided on daatan#1491).
 *
 * The sweep records OpenRouter payment failures per UTC day in
 * `panel_payment_failures` (`recordPanelPaymentFailure`); this reads every row whose
 * last occurrence falls inside the lookback window and reports them as ONE issue —
 * the condition is "the shared account is out of credits", not anything per-model or
 * per-forecast. A day row straddling the window boundary contributes its whole day's
 * count; over-counting a boundary is harmless where any nonzero count is an outage.
 */
async function panelPaymentBurst(now: Date): Promise<EvidenceHealthIssue[]> {
  const since = new Date(now.getTime() - PANEL_402_LOOKBACK_HOURS * 60 * 60 * 1000)
  const rows = await prisma.panelPaymentFailure.findMany({
    where: { lastSeenAt: { gt: since } },
  })
  if (rows.length === 0) return []

  const latest = rows.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b))
  return [
    {
      kind: 'panel_payment_failure',
      count: rows.reduce((n, r) => n + r.count, 0),
      lastSeenAt: latest.lastSeenAt,
      lastModel: latest.lastModel,
    },
  ]
}

/**
 * Newest commit touching the batch loop's progress file, via the public GitHub
 * API (the repo is public; one unauthenticated call per daily run is nowhere
 * near the 60/hr/IP limit).
 *
 * Never throws, unlike the DB checks: `checkEvidenceHealth`'s throw-on-failure
 * contract exists so a run that can't read the pool doesn't report a clean
 * pipeline, but a GitHub blip must neither kill the DB checks nor masquerade as
 * "batch loop dead". An unreachable heartbeat is its own, explicitly weaker
 * condition — fired as `batch_heartbeat_unreachable` so a broken URL or a
 * repo-visibility change can't silence this check forever.
 */
async function batchLoopHeartbeat(now: Date): Promise<EvidenceHealthIssue[]> {
  const url =
    `https://api.github.com/repos/${BATCH_HEARTBEAT_REPO}/commits` +
    `?path=${encodeURIComponent(BATCH_HEARTBEAT_PATH)}&per_page=1`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(BATCH_HEARTBEAT_TIMEOUT_MS),
    })
    if (!res.ok) {
      return [{ kind: 'batch_heartbeat_unreachable', detail: `HTTP ${res.status}` }]
    }
    const commits = (await res.json()) as Array<{ commit?: { committer?: { date?: string } } }>
    const dateStr = commits[0]?.commit?.committer?.date
    const lastCommitAt = dateStr ? new Date(dateStr) : null
    if (!lastCommitAt || Number.isNaN(lastCommitAt.getTime())) {
      return [{ kind: 'batch_heartbeat_unreachable', detail: 'no commit date in response' }]
    }
    const hoursSince = (now.getTime() - lastCommitAt.getTime()) / (60 * 60 * 1000)
    if (hoursSince >= BATCH_HEARTBEAT_STALE_HOURS) {
      return [
        {
          kind: 'batch_heartbeat_stale',
          hoursSince: Math.round(hoursSince),
          thresholdHours: BATCH_HEARTBEAT_STALE_HOURS,
          lastCommitAt: lastCommitAt.toISOString(),
        },
      ]
    }
    return []
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return [{ kind: 'batch_heartbeat_unreachable', detail: detail.slice(0, 120) }]
  }
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
    case 'panel_payment_failure':
      return 'panel-payment'
    case 'batch_heartbeat_stale':
      return 'batch-heartbeat-stale'
    case 'batch_heartbeat_unreachable':
      return 'batch-heartbeat-unreachable'
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

  const [recent, baseline, emptyForecasts, panelPayment, heartbeatIssues] = await Promise.all([
    windowStats(recentFrom, null),
    windowStats(baselineFrom, recentFrom),
    forecastsWithoutEvidence(),
    panelPaymentBurst(now),
    batchLoopHeartbeat(now),
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
  issues.push(...panelPayment)
  issues.push(...heartbeatIssues)

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
