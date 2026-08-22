import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import { refreshOracleSnapshot, type SuppliedArticle } from '@/lib/services/oracle-backfill'
import { createLogger } from '@/lib/logger'

const log = createLogger('degraded-fetch-backfill')

/**
 * daatan#1446. The 11 domains retro#520/#521 fixed (the Oracle's second-visit fetch
 * used to fall back to a ~200-char title+snippet on these). This is the SAME list
 * the issue was scoped to — not the wider off-list population (Telegram, timesofisrael.com,
 * washingtonpost.com, reliefweb.int, aljazeera.com without the .net) the 17:41 comment
 * also found. Widening it is a separate follow-up, not part of this sweep.
 */
export const DEGRADED_FETCH_DOMAINS = [
  'aa.com.tr',
  'reuters.com',
  'nytimes.com',
  'bloomberg.com',
  'lemonde.fr',
  'msn.com',
  'thehill.com',
  'israelnationalnews.com',
  'middleeasteye.net',
  'phys.org',
  'aljazeera.net',
] as const

/**
 * The join window the 17:41 comment's row-level count (432 rows / 67 predictions) was
 * drawn from: rows extracted before the retro#521 fix shipped. Rows on/after this date
 * may already have gone through the fixed fetch path and don't belong in the sweep.
 */
export const CONFIRMED_DEGRADED_CUTOFF = new Date('2026-08-12T00:00:00.000Z')

/**
 * The domain+date+status shape the 432-row confirmed population was drawn from —
 * NOT the row-level join itself. The join lives in `oracle_log.txt` on the Oracle
 * EC2 box (md5(url) keyed on `using=fallback`) and isn't queryable from inside this
 * worktree, so this filter is a **broader, unconfirmed superset**: every row that
 * COULD be one of the 432, not a re-derivation of which ones actually are. Expect
 * this to select more than 432 rows (the 17:41 join also excluded rows where the URL
 * only started succeeding after being written, and rows that got real text despite
 * being on one of these domains). A human should spot-check the count lands in the
 * hundreds, not the ~1,600 the issue's original (pre-join) upper bound used.
 */
export interface DegradedFetchWhereOptions {
  cutoff?: Date
  /** hashUrl() values of the row-level confirmed population (daatan#1446 log join).
   *  When present, replaces the domain filter entirely: the domain shape is the
   *  unconfirmed superset (1,605 rows), the allowlist is the confirmed set (402). */
  urlHashAllowlist?: readonly string[]
}

export function degradedFetchWhere(
  options: DegradedFetchWhereOptions = {},
): Prisma.EvidencePoolArticleWhereInput {
  const { cutoff = CONFIRMED_DEGRADED_CUTOFF, urlHashAllowlist } = options
  return {
    status: 'COMPLETE',
    updatedAt: { lt: cutoff },
    ...(urlHashAllowlist
      ? { urlHash: { in: [...urlHashAllowlist] } }
      : {
          OR: [
            { source: { in: [...DEGRADED_FETCH_DOMAINS] } },
            { outletName: { in: [...DEGRADED_FETCH_DOMAINS] } },
          ],
        }),
  }
}

/** mean/std/CI pulled out of a ContextSnapshot, on the 0–100 percent scale
 *  (see stanceToPercent) — the shape both the "before" and "after" reading share. */
export interface SnapshotSummary {
  id: string
  createdAt: Date
  mean: number | null
  std: number | null
  ciLow: number | null
  ciHigh: number | null
}

/** The most recent non-clock ContextSnapshot for a prediction, reduced to the
 *  fields the diff report needs. Clock rows are the requote cron's arithmetic
 *  glide, not new evidence — excluded the same way context.ts's NOT_CLOCK does. */
async function latestSnapshotSummary(predictionId: string): Promise<SnapshotSummary | null> {
  const snap = await prisma.contextSnapshot.findFirst({
    where: { predictionId, kind: { not: 'clock' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, externalProbability: true, oracleSnapshot: true },
  })
  if (!snap) return null
  const oracle = snap.oracleSnapshot as { std?: number; ciLow?: number; ciHigh?: number } | null
  return {
    id: snap.id,
    createdAt: snap.createdAt,
    mean: snap.externalProbability ?? null,
    std: oracle?.std ?? null,
    ciLow: oracle?.ciLow ?? null,
    ciHigh: oracle?.ciHigh ?? null,
  }
}

/** One prediction's before/after ContextSnapshot pair, captured around its re-extraction. */
export interface PredictionSnapshotPair {
  predictionId: string
  before: SnapshotSummary | null
  after: SnapshotSummary | null
}

export interface DegradedFetchSweepResult {
  /** Predictions this call ran the Oracle for. */
  processed: number
  /** Rows re-driven through extraction across those predictions. */
  rowsRetried: number
  ok: number
  noOracle: number
  unchanged: number
  insufficient: number
  failed: number
  /** Retryable rows still matching the filter — the sweep's convergence gauge. */
  remaining: number
  /** Of `remaining`, how many have a non-null contentHash (daatan#1466). This sweep
   *  re-sends each row's OWN stored title+snippet, so a non-null hash re-hashes to
   *  itself and gates as `unchanged` every time — these rows are a hard floor, not
   *  slow-but-reachable progress. Only null-contentHash rows can actually move. */
  gated: number
  /** Before/after ContextSnapshot pair per prediction the sweep actually ran, for
   *  {@link buildDegradedFetchDiffReport}. */
  diffs: PredictionSnapshotPair[]
}

/**
 * Re-extract the confirmed-degraded population through the normal extraction path
 * — same shape as `retryPoolExtractions` (pool-retry.ts), but scoped to
 * `degradedFetchWhere()` instead of the FAILED/PENDING retry gate: these rows are
 * COMPLETE, not stuck, and re-driving them isn't a retry, it's a redo now that
 * `/articles/text` serves the archived body instead of falling back.
 *
 * Since PR #1441 (evidence-pool version-chain writes), completing a row here writes
 * a NEW version instead of overwriting in place — the pre-sweep row survives in the
 * chain for free. No separate backup step.
 *
 * **Not called by anything yet.** daatan#1446 is explicit that running this against
 * live forecasts is a follow-up product decision, not this PR — see the route/tests
 * this ships alongside. Building it does not run it.
 */
export async function sweepDegradedFetchRows(
  limit: number,
  whereOptions: DegradedFetchWhereOptions = {},
): Promise<DegradedFetchSweepResult> {
  const where = degradedFetchWhere(whereOptions)

  const groups = await prisma.evidencePoolArticle.groupBy({
    by: ['predictionId'],
    where,
    _count: { _all: true },
  })
  const backlogById = new Map(groups.map((g) => [g.predictionId, g._count._all]))
  const active = await prisma.prediction.findMany({
    where: { id: { in: [...backlogById.keys()] }, status: 'ACTIVE' },
    select: { id: true, claimText: true, claimDirection: true, claimDeadline: true, createdAt: true, claimArchetype: true, resolutionRules: true },
  })
  const candidates = active
    .sort((a, b) => (backlogById.get(b.id) ?? 0) - (backlogById.get(a.id) ?? 0))
    .slice(0, limit)

  const remainingBefore = await prisma.evidencePoolArticle.count({
    where: { ...where, prediction: { status: 'ACTIVE' } },
  })
  const gatedBefore = await prisma.evidencePoolArticle.count({
    where: { ...where, prediction: { status: 'ACTIVE' }, contentHash: { not: null } },
  })
  log.info({ remainingBefore, gatedBefore }, 'degraded-fetch-backfill.candidates')

  const results: DegradedFetchSweepResult = {
    processed: 0,
    rowsRetried: 0,
    ok: 0,
    noOracle: 0,
    unchanged: 0,
    insufficient: 0,
    failed: 0,
    remaining: 0,
    gated: 0,
    diffs: [],
  }

  for (const p of candidates) {
    const rows = await prisma.evidencePoolArticle.findMany({
      where: { ...where, predictionId: p.id },
      orderBy: { updatedAt: 'asc' },
      take: DEFAULT_MAX_ARTICLES,
      select: { url: true, title: true, snippet: true, source: true, publishedDate: true },
    })
    const articles: SuppliedArticle[] = rows.flatMap((r) =>
      r.title
        ? [{ url: r.url, title: r.title, snippet: r.snippet ?? '', source: r.source ?? undefined, publishedDate: r.publishedDate ?? undefined }]
        : [],
    )
    if (articles.length === 0) continue

    const before = await latestSnapshotSummary(p.id)
    results.processed++
    results.rowsRetried += articles.length
    try {
      // reask: true, same reasoning as pool-retry.ts — nothing waits on this call's
      // response, so a client-timeout recovery is free.
      const r = await refreshOracleSnapshot(p, { articles, origin: 'retry', reask: true })
      if (r.status === 'ok') results.ok++
      else if (r.status === 'unchanged') results.unchanged++
      else if (r.status === 'insufficient') results.insufficient++
      else results.noOracle++

      const after = await latestSnapshotSummary(p.id)
      results.diffs.push({ predictionId: p.id, before, after })
    } catch (err) {
      results.failed++
      log.warn({ predictionId: p.id, err }, 'degraded-fetch-backfill.prediction_failed')
    }
  }

  results.remaining = await prisma.evidencePoolArticle.count({
    where: { ...where, prediction: { status: 'ACTIVE' } },
  })
  results.gated = await prisma.evidencePoolArticle.count({
    where: { ...where, prediction: { status: 'ACTIVE' }, contentHash: { not: null } },
  })
  if (results.remaining === remainingBefore) {
    log.warn({ ...results, remainingBefore }, 'degraded-fetch-backfill.no_forward_progress')
  }
  log.info(results, 'degraded-fetch-backfill.done')
  return results
}

/** One row of the movement report: how far a prediction's AI estimate moved
 *  across its re-extraction, ready to render as JSON or plain text. */
export interface DegradedFetchDiffRow {
  predictionId: string
  meanBefore: number | null
  meanAfter: number | null
  meanDelta: number | null
  stdBefore: number | null
  stdAfter: number | null
  stdDelta: number | null
  /** abs(meanDelta), or 0 when a delta can't be computed (missing before/after
   *  reading) — the sort key, not a claim that nothing moved. */
  movement: number
}

/**
 * Diff each swept prediction's before/after ContextSnapshot and sort by movement
 * magnitude (largest first) — the report step (Step 3) the issue asks for. Pure
 * function over the pairs `sweepDegradedFetchRows` already captured; it does not
 * read the DB itself; this is not published/decided anywhere, it's the input to
 * that later decision.
 */
export function buildDegradedFetchDiffReport(diffs: PredictionSnapshotPair[]): DegradedFetchDiffRow[] {
  return diffs
    .map((d): DegradedFetchDiffRow => {
      const meanBefore = d.before?.mean ?? null
      const meanAfter = d.after?.mean ?? null
      const stdBefore = d.before?.std ?? null
      const stdAfter = d.after?.std ?? null
      const meanDelta = meanBefore !== null && meanAfter !== null ? meanAfter - meanBefore : null
      const stdDelta = stdBefore !== null && stdAfter !== null ? stdAfter - stdBefore : null
      return {
        predictionId: d.predictionId,
        meanBefore,
        meanAfter,
        meanDelta,
        stdBefore,
        stdAfter,
        stdDelta,
        movement: meanDelta !== null ? Math.abs(meanDelta) : 0,
      }
    })
    .sort((a, b) => b.movement - a.movement)
}
