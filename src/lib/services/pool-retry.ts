import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_MAX_ARTICLES, ORACLE_NULL_REASONS } from '@/lib/services/oracle'
import { TERMINAL_POOL_REASONS } from '@/lib/services/evidence-pool'
import { refreshOracleSnapshot, type SuppliedArticle } from '@/lib/services/oracle-backfill'
import { createLogger } from '@/lib/logger'

const log = createLogger('pool-retry')

/**
 * One retry per row per day. A row that fails again drops out of the retryable set
 * until tomorrow (its updatedAt was bumped), so `remaining` strictly shrinks within
 * a workflow run and a permanently-broken article costs at most one Oracle look a
 * day instead of a hot loop. Also keeps the sweep clear of anything in-flight.
 */
const RETRY_MIN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Rows worth re-driving through extraction: stuck claims EXCEPT the terminal
 * reasons (`TERMINAL_POOL_REASONS` — the gatekeeper's "irrelevant" verdict, and the
 * twice-null attempt cap below). Old PENDING rows are abandoned claims (the
 * pre-#1149 graveyard: claimed, then neither completed nor failed). Title is
 * required because a row without one cannot be re-pushed at all; a claim-lifecycle
 * row always has one.
 *
 * The terminal list is shared with the organic claim gate (evidence-pool.ts) rather
 * than repeated here: the two used to disagree, so "terminal" was true of the sweep
 * and false of every re-push arriving from news-indexer (daatan#1232).
 */
function retryableWhere(cutoff: Date): Prisma.EvidencePoolArticleWhereInput {
  return {
    excluded: false,
    title: { not: null },
    updatedAt: { lt: cutoff },
    OR: [
      { status: 'FAILED', statusReason: null },
      { status: 'FAILED', statusReason: { notIn: [...TERMINAL_POOL_REASONS] } },
      { status: 'PENDING' },
    ],
  }
}

export interface RetrySweepResult {
  /** Predictions this call ran the Oracle for. */
  processed: number
  /** Stuck rows re-driven through extraction across those predictions. */
  rowsRetried: number
  ok: number
  noOracle: number
  unchanged: number
  insufficient: number
  failed: number
  /** Rows stamped oracle_null_final this call — second consecutive null, out of the sweep. */
  finalized: number
  /** Retryable rows still waiting on ACTIVE forecasts — the workflow's convergence gauge. */
  remaining: number
}

/**
 * Drain stuck evidence-pool rows by re-driving them through the normal
 * extraction path: biggest ACTIVE-forecast backlogs first, up to `limit`
 * predictions per call, up to DEFAULT_MAX_ARTICLES rows each. Delegates to
 * refreshOracleSnapshot with supplied articles, so claim/extract/pool/
 * omitted-release/aggregate/persist behave exactly like a backfill run — a row
 * the gatekeeper rejects again comes back FAILED/oracle_omitted (terminal), one
 * that extracts comes back COMPLETE and joins the persisted estimate.
 */
export async function retryPoolExtractions(limit: number): Promise<RetrySweepResult> {
  const cutoff = new Date(Date.now() - RETRY_MIN_AGE_MS)
  const retryable = retryableWhere(cutoff)

  const groups = await prisma.evidencePoolArticle.groupBy({
    by: ['predictionId'],
    where: retryable,
    _count: { _all: true },
  })
  const backlogById = new Map(groups.map((g) => [g.predictionId, g._count._all]))
  const active = await prisma.prediction.findMany({
    where: { id: { in: [...backlogById.keys()] }, status: 'ACTIVE' },
    select: { id: true, claimText: true, claimDirection: true, claimDeadline: true, createdAt: true, claimArchetype: true },
  })
  const candidates = active
    .sort((a, b) => (backlogById.get(b.id) ?? 0) - (backlogById.get(a.id) ?? 0))
    .slice(0, limit)

  const results: RetrySweepResult = {
    processed: 0,
    rowsRetried: 0,
    ok: 0,
    noOracle: 0,
    unchanged: 0,
    insufficient: 0,
    failed: 0,
    finalized: 0,
    remaining: 0,
  }

  for (const p of candidates) {
    const rows = await prisma.evidencePoolArticle.findMany({
      where: { ...retryable, predictionId: p.id },
      orderBy: { updatedAt: 'asc' },
      take: DEFAULT_MAX_ARTICLES,
      select: { url: true, title: true, snippet: true, source: true, publishedDate: true, statusReason: true },
    })
    // Second-strike rule: a batch where the Oracle rejects EVERY article comes back as a
    // null forecast, so its rows land on a retryable null-family reason. Rows that were
    // ALREADY null-family before this claim (captured here, since claiming resets
    // statusReason) and go null again get stamped terminal below: two independent null
    // runs a day apart is the article telling us it's dead, not the Oracle hiccuping. An
    // organic re-push with changed content can still revive them — only the sweep stops.
    //
    // Matched against the SET, not the literal `'oracle_null'`. daatan#1231 split that one
    // string into per-cause reasons, and a strict-equality check here would silently stop
    // recognising every newly-written row — no second strike, no `oracle_null_final`, and
    // the sweep would re-drive dead articles forever. (`oracle_null` stays in the set for
    // rows written before the split.) Which of these classes DESERVES a retry is a
    // separate question, deliberately left to daatan#1232.
    const secondStrike = rows
      .filter((r) => r.title && r.statusReason && ORACLE_NULL_REASONS.includes(r.statusReason))
      .map((r) => r.url)
    // Re-push with the snippet the ORIGINAL attempt carried (daatan#1232). This used to
    // hard-code `snippet: ''`, so the retry sent strictly less text than the attempt that
    // already failed — for a Telegram row whose only content is the snippet, that made the
    // second null near-deterministic and the `oracle_null_final` stamp below a
    // self-fulfilling prophecy rather than a genuine re-test. Rows pooled before the column
    // existed still have no snippet and fall back to title-only, exactly as before.
    const articles: SuppliedArticle[] = rows.flatMap((r) =>
      r.title
        ? [{ url: r.url, title: r.title, snippet: r.snippet ?? '', source: r.source ?? undefined, publishedDate: r.publishedDate ?? undefined }]
        : [],
    )
    if (articles.length === 0) continue
    results.processed++
    results.rowsRetried += articles.length
    try {
      const r = await refreshOracleSnapshot(p, { articles, origin: 'retry' })
      if (r.status === 'ok') results.ok++
      else if (r.status === 'unchanged') results.unchanged++
      else if (r.status === 'insufficient') results.insufficient++
      else {
        results.noOracle++
        if (r.status === 'no-oracle' && secondStrike.length > 0) {
          const { count } = await prisma.evidencePoolArticle.updateMany({
            // Guarded on FAILED + a null-family reason so a row a concurrent push just
            // completed (or failed for an unrelated reason like oracle_omitted) is never
            // stamped terminal.
            where: { predictionId: p.id, url: { in: secondStrike }, status: 'FAILED', statusReason: { in: [...ORACLE_NULL_REASONS] } },
            data: { statusReason: 'oracle_null_final' },
          })
          results.finalized += count
        }
      }
    } catch (err) {
      results.failed++
      log.warn({ predictionId: p.id, err }, 'pool-retry.prediction_failed')
    }
  }

  results.remaining = await prisma.evidencePoolArticle.count({
    where: { ...retryable, prediction: { status: 'ACTIVE' } },
  })
  log.info(results, 'pool-retry.done')
  return results
}
