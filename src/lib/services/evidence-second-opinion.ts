import { Prisma, type ClaimDirection, type ClaimArchetype } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { getOracleForecast } from '@/lib/services/oracle'
import type { EvidenceSecondOpinionIssue } from '@/lib/services/telegram'

const log = createLogger('evidence-second-opinion')

/**
 * Twice-weekly "interesting cases" audit (daatan#1636), built after the manual
 * 2026-08-26 outlier scan showed a naive "article stance vs. published number"
 * comparison is mostly noise once Gate-0 (retro#545 slice iii) is enforced: old
 * articles that Gate-0 correctly zero-weights still show up as huge deviations,
 * because Gate-0's window check happens INSIDE retro's aggregation — it zeros an
 * ephemeral in-memory weights list, never a persisted per-row field. In particular
 * `evidence_pool_articles.evidence_weight` is NOT that — per retro's own field
 * description it is only the evidence_class-derived weight component
 * (`credibility * evidence_weight * recency * relevance^2`'s middle term),
 * unrelated to the temporal window; a Gate-0-excluded row can carry a perfectly
 * normal evidence_weight. Detector 1's candidate query below re-derives the same
 * window retro's `evidence_window_outside()` computes (aggregation.py), rather
 * than trusting any persisted column, so old out-of-window articles never reach
 * the model-disagreement check at all.
 *
 * Detector 1: for articles that carry real weight (inside the Gate-0 window) and
 * deviate sharply from the forecast's published number, get a second opinion from
 * a stronger model on that SAME article and escalate only when the cheap and
 * expensive readings themselves disagree — agreement (even against the published
 * number) is treated as real new evidence the normal ingestion path already
 * self-heals from (Daatan/docs decisions.md, 2026-08-26).
 *
 * Detector 2: pure SQL, no model calls — same-source stance drift over time.
 */

/** Mirrors retro's `evidence_window_lookback_days` default (config.py) — see
 *  Daatan/docs decisions.md 2026-08-19 "Gate 0". */
export const GATE0_LOOKBACK_DAYS = 30

/** Candidate window: since roughly the last run, with slack for the Mon/Thu gap
 *  (3-4 days) plus cron drift. */
export const CANDIDATE_WINDOW_DAYS = 4

/** Article-vs-published deviation that makes an article worth a second opinion. */
export const DEVIATION_TRIGGER_PP = 20

/** Cheap-vs-expensive disagreement on the SAME article that escalates to Telegram. */
export const DISAGREEMENT_ESCALATE_PP = 15

/** Cost guard: worst-case re-extractions (expensive-model calls) per run. */
export const MAX_REEXTRACTIONS_PER_RUN = 10

/** Same-source, different-time stance delta worth a look (detector 2) — wider
 *  than detector 1's bar since a source's story legitimately shifting over time
 *  is expected, not itself evidence of a bug. */
export const SOURCE_DRIFT_TRIGGER_PP = 25

const DEFAULT_EXPENSIVE_MODEL = 'bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0'

function expensiveModel(): string {
  return env.EVIDENCE_SECOND_OPINION_MODEL || DEFAULT_EXPENSIVE_MODEL
}

function stancePct(stance: number): number {
  return Math.round(((stance + 1) / 2) * 100 * 10) / 10
}

interface CandidateRow {
  article_id: string
  prediction_id: string
  url: string
  title: string
  snippet: string | null
  source: string | null
  published_date: string | null
  stance_pct: number
  claim_text: string
  slug: string | null
  confidence: number
  claim_deadline: Date | null
  claim_direction: ClaimDirection | null
  claim_archetype: ClaimArchetype | null
  resolution_rules: string | null
  created_at: Date
}

/**
 * Recently-completed, in-window, usable pool rows whose extracted stance
 * deviates >= {@link DEVIATION_TRIGGER_PP} from the forecast's published
 * `confidence`, worst deviation first.
 *
 * "In-window" re-derives retro's Gate-0 check (`evidence_window_outside()`,
 * aggregation.py) directly rather than reading a persisted weight — see the
 * module docstring for why `evidence_weight` doesn't do this. A row's date is
 * its `settlement_event_date` when parseable, else `published_date`
 * (retro's exact fallback order); a row with neither is treated as in-window
 * (fail-open, matching retro). `scheduled`-archetype claims are exempt, exactly
 * as on retro's side.
 */
async function findCandidates(now: Date): Promise<CandidateRow[]> {
  const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH usable AS (
      SELECT
        e.id,
        e."predictionId",
        e.url,
        e.title,
        e.snippet,
        e.source,
        e.published_date,
        round(((e.stance + 1) / 2 * 100)::numeric, 1)::float8 AS stance_pct,
        COALESCE(
          CASE WHEN left(e.settlement_event_date, 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
               THEN left(e.settlement_event_date, 10)::date END,
          CASE WHEN left(e.published_date, 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
               THEN left(e.published_date, 10)::date END
        ) AS row_date
      FROM evidence_pool_articles e
      WHERE e.excluded = false
        AND e.status = 'COMPLETE'
        AND e.superseded_at IS NULL
        AND e.title IS NOT NULL
        AND e.stance IS NOT NULL AND e.certainty IS NOT NULL
        AND e.credibility_weight IS NOT NULL AND e.relevance_score IS NOT NULL
        AND e.added_at >= ${since}
    )
    SELECT
      u.id AS article_id,
      u."predictionId" AS prediction_id,
      u.url,
      u.title,
      u.snippet,
      u.source,
      u.published_date,
      u.stance_pct,
      p."claimText" AS claim_text,
      p.slug,
      p.confidence,
      p.claim_deadline,
      p.claim_direction,
      p.claim_archetype,
      p."resolutionRules" AS resolution_rules,
      p."createdAt" AS created_at
    FROM usable u
    JOIN predictions p ON p.id = u."predictionId"
    WHERE p.status = 'ACTIVE'
      AND p.confidence IS NOT NULL
      AND (
        p.claim_archetype = 'SCHEDULED'
        OR u.row_date IS NULL
        OR (
          u.row_date >= (p."createdAt"::date - (${GATE0_LOOKBACK_DAYS} || ' days')::interval)
          AND (p.claim_deadline IS NULL OR u.row_date <= p.claim_deadline::date)
        )
      )
      AND abs(u.stance_pct - p.confidence) >= ${DEVIATION_TRIGGER_PP}
    ORDER BY abs(u.stance_pct - p.confidence) DESC
    LIMIT ${MAX_REEXTRACTIONS_PER_RUN}
  `)
}

/**
 * Re-read one candidate article with the expensive model, isolated to that one
 * article (`articles: [...]`, `max_articles` unaffected — see getOracleForecast).
 * Never persists anything: this is a diagnostic re-read, not a pool write.
 * Returns null on any Oracle failure (unconfigured, transport, abstain) — a
 * missing second opinion is silently skipped, not escalated.
 */
async function secondOpinion(row: CandidateRow): Promise<number | null> {
  const result = await getOracleForecast(
    row.claim_text,
    {
      articles: [
        {
          url: row.url,
          title: row.title,
          snippet: row.snippet ?? '',
          source: row.source ?? undefined,
          publishedDate: row.published_date ?? undefined,
        },
      ],
      model: expensiveModel(),
      claimDirection: row.claim_direction,
      claimDeadline: row.claim_deadline,
      claimCreatedAt: row.created_at,
      claimArchetype: row.claim_archetype,
      resolutionRules: row.resolution_rules,
    },
    { source: 'evidence-second-opinion', predictionId: row.prediction_id },
  )
  if (!result.forecast) return null
  return stancePct(result.forecast.mean)
}

interface ModelDisagreementFinding {
  key: string
  issue: Extract<EvidenceSecondOpinionIssue, { kind: 'model_disagreement' }>
}

/**
 * One expensive-model call per candidate, run CONCURRENTLY — they're independent
 * (different articles/predictions), and the cost guard is the SQL LIMIT on
 * `findCandidates`, not serialization. Sequential would risk the cron route's own
 * timeout at MAX_REEXTRACTIONS_PER_RUN x FORECAST_TIMEOUT_MS (up to 5 minutes).
 */
async function runDetector1(candidates: CandidateRow[]): Promise<ModelDisagreementFinding[]> {
  const results = await Promise.all(
    candidates.map(async (row) => {
      const expensivePct = await secondOpinion(row)
      if (expensivePct === null) return null

      const disagreement = Math.abs(row.stance_pct - expensivePct)
      log.info(
        { predictionId: row.prediction_id, articleId: row.article_id, cheapPct: row.stance_pct, expensivePct, disagreement },
        'event=second_opinion_checked',
      )
      if (disagreement < DISAGREEMENT_ESCALATE_PP) return null

      const finding: ModelDisagreementFinding = {
        key: `model-disagreement:${row.article_id}`,
        issue: {
          kind: 'model_disagreement',
          predictionId: row.prediction_id,
          claimText: row.claim_text,
          slug: row.slug,
          articleUrl: row.url,
          articleTitle: row.title,
          cheapPct: row.stance_pct,
          expensivePct,
          publishedPct: row.confidence,
        },
      }
      return finding
    }),
  )
  return results.filter((f): f is ModelDisagreementFinding => f !== null)
}

interface SourceDriftRow {
  prediction_id: string
  claim_text: string
  slug: string | null
  source: string
  older_pct: number
  newer_pct: number
  older_date: string
  newer_date: string
}

interface SourceDriftFinding {
  key: string
  issue: Extract<EvidenceSecondOpinionIssue, { kind: 'source_drift' }>
}

/**
 * Same source, same forecast, two dated articles whose stance moved by
 * >= {@link SOURCE_DRIFT_TRIGGER_PP} — the widest and narrowest dated reading per
 * (prediction, source) pair. Pure SQL, no model calls: a genuine gap no existing
 * mechanism covers (no comparison across time for one outlet on one forecast).
 */
async function runDetector2(now: Date): Promise<SourceDriftFinding[]> {
  const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRaw<SourceDriftRow[]>(Prisma.sql`
    WITH dated AS (
      SELECT
        e."predictionId",
        e.source,
        round(((e.stance + 1) / 2 * 100)::numeric, 1)::float8 AS stance_pct,
        CASE WHEN left(e.published_date, 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
             THEN left(e.published_date, 10)::date END AS row_date
      FROM evidence_pool_articles e
      WHERE e.excluded = false
        AND e.status = 'COMPLETE'
        AND e.superseded_at IS NULL
        AND e.source IS NOT NULL
        AND e.stance IS NOT NULL AND e.certainty IS NOT NULL
        AND e.credibility_weight IS NOT NULL AND e.relevance_score IS NOT NULL
        AND e.added_at >= ${since}
    ),
    dated_only AS (
      SELECT * FROM dated WHERE row_date IS NOT NULL
    ),
    per_pair AS (
      SELECT
        "predictionId", source,
        min(row_date) AS min_date, max(row_date) AS max_date,
        (array_agg(stance_pct ORDER BY row_date ASC))[1] AS older_pct,
        (array_agg(stance_pct ORDER BY row_date DESC))[1] AS newer_pct
      FROM dated_only
      GROUP BY "predictionId", source
      HAVING min(row_date) < max(row_date)
    )
    SELECT
      pp."predictionId" AS prediction_id,
      p."claimText" AS claim_text,
      p.slug,
      pp.source,
      pp.older_pct,
      pp.newer_pct,
      pp.min_date::text AS older_date,
      pp.max_date::text AS newer_date
    FROM per_pair pp
    JOIN predictions p ON p.id = pp."predictionId"
    WHERE p.status = 'ACTIVE'
      AND abs(pp.newer_pct - pp.older_pct) >= ${SOURCE_DRIFT_TRIGGER_PP}
    ORDER BY abs(pp.newer_pct - pp.older_pct) DESC
  `)

  return rows.map((r) => ({
    key: `source-drift:${r.prediction_id}:${r.source}:${r.newer_date}`,
    issue: {
      kind: 'source_drift',
      predictionId: r.prediction_id,
      claimText: r.claim_text,
      slug: r.slug,
      source: r.source,
      olderPct: Number(r.older_pct),
      newerPct: Number(r.newer_pct),
      olderDate: r.older_date,
      newerDate: r.newer_date,
    },
  }))
}

/**
 * Claim the findings nobody has alerted on yet, and release the ones that no
 * longer hold — same reconcile-wholesale shape as evidence-health.ts's
 * `reconcileAlerts`. Only the run that actually creates a key's row reports it,
 * so an overlapping run can't page twice for the same case; deleting stale keys
 * re-arms them for the next time the same case recurs.
 */
async function reconcileAlerts(activeKeys: string[]): Promise<Set<string>> {
  const active = new Set(activeKeys)
  const existing = new Set(
    (await prisma.evidenceSecondOpinionAlert.findMany({ select: { key: true } })).map((r) => r.key),
  )

  const claimed = new Set<string>()
  for (const key of active) {
    if (existing.has(key)) continue
    const { count } = await prisma.evidenceSecondOpinionAlert.createMany({
      data: [{ key }],
      skipDuplicates: true,
    })
    if (count > 0) claimed.add(key)
  }

  const stale = [...existing].filter((k) => !active.has(k))
  if (stale.length > 0) {
    await prisma.evidenceSecondOpinionAlert.deleteMany({ where: { key: { in: stale } } })
  }

  return claimed
}

export interface EvidenceSecondOpinionResult {
  issues: EvidenceSecondOpinionIssue[]
  suppressed: number
  articlesChecked: number
}

/**
 * Run both detectors, reconcile fire/re-arm state, and return what's newly
 * broken. `dryRun` skips the reconcile/claim step entirely so a manual run can
 * inspect the report without consuming the dedup ledger — mirrors
 * `republishForecasts`' dry-run/apply split.
 */
export async function checkEvidenceSecondOpinion(
  now: Date = new Date(),
  opts: { dryRun?: boolean } = {},
): Promise<EvidenceSecondOpinionResult> {
  const candidates = await findCandidates(now)
  const [detector1, detector2] = await Promise.all([runDetector1(candidates), runDetector2(now)])

  const findings = [...detector1, ...detector2]
  const allIssues = findings.map((f) => f.issue)

  if (opts.dryRun) {
    log.info({ articlesChecked: candidates.length, findings: findings.length }, 'event=evidence_second_opinion_dry_run')
    return { issues: allIssues, suppressed: 0, articlesChecked: candidates.length }
  }

  const claimed = await reconcileAlerts(findings.map((f) => f.key))
  const fired = findings.filter((f) => claimed.has(f.key)).map((f) => f.issue)

  log.info(
    { articlesChecked: candidates.length, active: findings.length, fired: fired.length },
    'event=evidence_second_opinion_check',
  )

  return { issues: fired, suppressed: findings.length - fired.length, articlesChecked: candidates.length }
}
