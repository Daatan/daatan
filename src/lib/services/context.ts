import { Prisma, type ContextSnapshot } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { notifyHighConfidence } from '@/lib/services/telegram'

const log = createLogger('context-service')

/** AI-estimate level (0–100) at or above which a crossing fires a Telegram alert. */
const HIGH_CONFIDENCE_THRESHOLD = 80

/** Symmetric band outside which a forecast is added to the "Awaiting Resolution"
 *  tab (alongside deadline-passed PENDING ones) without touching `status` — an
 *  ACTIVE forecast stays ACTIVE, so staking stays open and the news-indexer keeps
 *  re-evaluating it. Level-based, not sticky: recomputed on every confidence
 *  write, so it clears the moment a later read lands back inside the band. */
const AWAITING_AI_RESOLUTION_LOW = 10
const AWAITING_AI_RESOLUTION_HIGH = 90

function isAwaitingAiResolution(confidence: number | null): boolean {
  return confidence !== null && (confidence >= AWAITING_AI_RESOLUTION_HIGH || confidence <= AWAITING_AI_RESOLUTION_LOW)
}

interface PreviousConfidence {
  confidence: number | null
  claimText: string
  slug: string | null
}

/** Snapshot the prediction's confidence (plus notification fields) before a write. */
async function readPreviousConfidence(predictionId: string): Promise<PreviousConfidence | null> {
  return prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { confidence: true, claimText: true, slug: true },
  })
}

/**
 * Fire the high-confidence Telegram alert when the new AI estimate crosses
 * HIGH_CONFIDENCE_THRESHOLD from below (or from no estimate). Crossing-based on
 * purpose: a forecast hovering above the bar doesn't re-alert on every update;
 * it re-alerts only after dipping below and climbing back.
 */
function notifyIfCrossedHighConfidence(
  predictionId: string,
  prev: PreviousConfidence | null,
  newConfidence: number | null,
  settled = false,
): void {
  if (prev === null || newConfidence === null) return
  if (newConfidence < HIGH_CONFIDENCE_THRESHOLD) return
  if (prev.confidence !== null && prev.confidence >= HIGH_CONFIDENCE_THRESHOLD) return
  notifyHighConfidence(
    { id: predictionId, claimText: prev.claimText, slug: prev.slug },
    newConfidence,
    prev.confidence,
    settled,
  )
}

/** Clock-driven requote snapshots are arithmetic, not events — excluded from the
 *  public timeline, from anchor selection, and from evidence-push dedup. */
const NOT_CLOCK: Prisma.ContextSnapshotWhereInput = { kind: { not: 'clock' } }

// ─── recordEstimate: the single estimate writer (retro docs/ORACLE_VARIABLES.md §6) ───

export type EstimateOrigin = 'creation' | 'analyze' | 'news-indexer' | 'backfill' | 'clock'

/** Per-origin behavior. Reproduces the pre-funnel writers exactly; the point is
 *  that the differences are now declared in one table instead of five functions. */
interface OriginPolicy {
  kind: 'evidence' | 'clock'
  /** Fire the high-confidence crossing alert on this origin's writes. */
  notifyOnCrossing: boolean
  /** May latch Prediction.settled (sticky). Clock/creation never carry settlement. */
  canSettle: boolean
  /** Owns the user-facing context: detailsText + contextUpdatedAt + translation
   *  invalidation. Only the user-triggered analyze path does. */
  touchesUserContext: boolean
}

const ORIGIN_POLICY: Record<EstimateOrigin, OriginPolicy> = {
  creation: { kind: 'evidence', notifyOnCrossing: false, canSettle: false, touchesUserContext: false },
  analyze: { kind: 'evidence', notifyOnCrossing: true, canSettle: true, touchesUserContext: true },
  'news-indexer': { kind: 'evidence', notifyOnCrossing: true, canSettle: true, touchesUserContext: false },
  backfill: { kind: 'evidence', notifyOnCrossing: true, canSettle: true, touchesUserContext: false },
  clock: { kind: 'clock', notifyOnCrossing: false, canSettle: false, touchesUserContext: false },
}

export interface RecordEstimateInput {
  predictionId: string
  origin: EstimateOrigin
  /** AI probability 0–100, or null when this run produced no number (e.g. a
   *  timeout) — in which case the prediction's needle AND band are both left
   *  untouched (never one without the other). */
  probability: number | null
  ciLow?: number | null
  ciHigh?: number | null
  /** The run abstained: records the snapshot as an abstention and clears the
   *  prediction's stale estimate (needle + band together). */
  insufficientData?: boolean
  /** Oracle settlement detection; honored only where the origin policy allows. */
  settled?: boolean
  summary?: string
  sources?: Prisma.InputJsonValue
  externalReasoning?: string | null
  oracleSnapshot?: Prisma.InputJsonValue | null
  /** Clock provenance JSON (origin='clock' only). */
  meta?: Prisma.InputJsonValue
  now?: Date
}

/** Oracle articles_used out of the snapshot payload, else null (LLM fallback, clock). */
function articlesUsedOf(oracleSnapshot: unknown): number | null {
  const n = (oracleSnapshot as { articlesUsed?: unknown } | null | undefined)?.articlesUsed
  return typeof n === 'number' ? n : null
}

/**
 * Persist one AI-estimate write — any origin — as a ContextSnapshot plus a
 * consistent Prediction update, in a single transaction.
 *
 * Invariants (uniform across origins, unlike the five pre-funnel writers):
 * - the snapshot always carries `origin`, `articlesUsed`, and its probability;
 * - `confidence` and `aiCiLow/aiCiHigh` move atomically — both written (with
 *   `awaitingAiResolution` recomputed), both cleared on abstention, or both
 *   left alone when the run produced no number;
 * - the settled latch and all notifications are decided here, per origin policy.
 */
export async function recordEstimate(input: RecordEstimateInput) {
  const policy = ORIGIN_POLICY[input.origin]
  const now = input.now ?? new Date()

  const willNotify = policy.notifyOnCrossing && !input.insufficientData && input.probability !== null
  const prev = willNotify ? await readPreviousConfidence(input.predictionId) : null

  const estimateFields: Prisma.PredictionUpdateInput = input.insufficientData
    ? { confidence: null, aiCiLow: null, aiCiHigh: null, awaitingAiResolution: false }
    : input.probability !== null
      ? {
          confidence: input.probability,
          awaitingAiResolution: isAwaitingAiResolution(input.probability),
          aiCiLow: input.ciLow ?? null,
          aiCiHigh: input.ciHigh ?? null,
        }
      : {}
  const predictionData: Prisma.PredictionUpdateInput = {
    ...estimateFields,
    ...(policy.canSettle && input.settled ? { settled: true, settledAt: now } : {}),
    ...(policy.touchesUserContext ? { detailsText: input.summary ?? '', contextUpdatedAt: now } : {}),
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.contextSnapshot.create({
      data: {
        predictionId: input.predictionId,
        kind: policy.kind,
        origin: input.origin,
        summary: input.summary ?? '',
        sources: input.sources ?? [],
        externalProbability: input.probability,
        externalReasoning: input.externalReasoning ?? null,
        oracleSnapshot: input.oracleSnapshot ?? undefined,
        insufficientData: input.insufficientData ?? false,
        meta: input.meta ?? undefined,
        articlesUsed: articlesUsedOf(input.oracleSnapshot),
      },
    }),
  ]
  if (Object.keys(predictionData).length > 0) {
    ops.push(prisma.prediction.update({ where: { id: input.predictionId }, data: predictionData }))
  }
  if (policy.touchesUserContext) {
    // This write overwrites the English summary — cached he/ru/eo translations
    // are now stale; dropping them makes SSR fall back until re-translation.
    ops.push(prisma.predictionTranslation.deleteMany({
      where: { predictionId: input.predictionId, fieldName: 'detailsText' },
    }))
  }

  const [snapshot] = await prisma.$transaction(ops)
  if (willNotify) {
    notifyIfCrossedHighConfidence(input.predictionId, prev, input.probability, input.settled)
  }
  return snapshot as ContextSnapshot
}

/**
 * The only way to clear the settled latch (see `recordEstimate` above — it
 * can only ever set `settled: true`, never false). A human override for a
 * false settlement (e.g. the 2026-07-08 F-35 incident, fixed by hand via a
 * prod DB UPDATE at the time). Re-admits the forecast to the temporal
 * clock's glide candidates (`CANDIDATE_WHERE: settled: false`) on its next
 * daily run; does not itself trigger a re-estimate.
 */
export async function clearSettledLatch(predictionId: string, clearedBy: string): Promise<void> {
  await prisma.prediction.update({
    where: { id: predictionId },
    data: { settled: false, settledAt: null },
  })
  log.info({ predictionId, clearedBy }, 'settled latch cleared')
}

/** Keep the heavy JSON (`sources[]` + `oracleSnapshot`) only for this many most-recent
 *  snapshots; older timeline rows are returned light. Bounds a payload that would
 *  otherwise grow with a forecast's entire update history. */
const CONTEXT_TIMELINE_HEAVY_LIMIT = 25

/**
 * Drop the heavy `sources[]` / `oracleSnapshot` blobs from all but the most-recent
 * `keepHeavy` snapshots (input must be newest-first). The probability chart reads only
 * `createdAt` + `externalProbability`, so its full history is untouched — only a deep-
 * scrolled timeline row loses its source chips. This is what keeps the timeline read
 * from growing unboundedly with a long-lived forecast's snapshot count.
 */
function stripHeavyTail(
  snapshots: ContextSnapshot[],
  keepHeavy = CONTEXT_TIMELINE_HEAVY_LIMIT,
): ContextSnapshot[] {
  return (snapshots ?? []).map((snap, i): ContextSnapshot =>
    i < keepHeavy ? snap : { ...snap, sources: [], oracleSnapshot: null },
  )
}

/** Fetch prediction with context snapshots for the GET timeline endpoint. */
export async function getContextTimeline(idOrSlug: string) {
  const prediction = await prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      id: true,
      detailsText: true,
      contextUpdatedAt: true,
      contextSnapshots: {
        where: NOT_CLOCK,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!prediction) return prediction
  return { ...prediction, contextSnapshots: stripHeavyTail(prediction.contextSnapshots) }
}

/** Fetch prediction with newsAnchor for the POST context-update endpoint. */
export async function getForecastForContextUpdate(idOrSlug: string) {
  return prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { newsAnchor: true },
  })
}

/** Count how many times a user has triggered context updates in the last `windowMs` ms. */
export async function countUserContextUpdates(userId: string, since: Date) {
  return prisma.prediction.count({
    where: {
      authorId: userId,
      contextUpdatedAt: { gte: since },
    },
  })
}

export interface SaveContextUpdateInput {
  predictionId: string
  summary: string
  sources: Prisma.InputJsonValue
  externalProbability: number | null
  externalReasoning: string | null
  oracleSnapshot: Prisma.InputJsonValue | null
  confidence: number | null
  aiCiLow: number | null
  aiCiHigh: number | null
  /** The Oracle abstained — no evidence bears on the claim. Records the snapshot
   *  as an abstention and CLEARS the prediction's stale AI estimate so the gauge
   *  shows "Insufficient evidence" rather than the last (now-unsupported) number. */
  insufficientData?: boolean
  /** Oracle settlement detection: the outcome was reported as an accomplished fact. */
  settled?: boolean
  now: Date
}

/** Persist a user-triggered analyze run. Adapter over recordEstimate — the route's
 *  `confidence` always equals `externalProbability`, unified as `probability`. */
export async function saveContextUpdate(input: SaveContextUpdateInput) {
  return recordEstimate({
    predictionId: input.predictionId,
    origin: 'analyze',
    probability: input.externalProbability,
    ciLow: input.aiCiLow,
    ciHigh: input.aiCiHigh,
    insufficientData: input.insufficientData,
    settled: input.settled,
    summary: input.summary,
    sources: input.sources,
    externalReasoning: input.externalReasoning,
    oracleSnapshot: input.oracleSnapshot,
    now: input.now,
  })
}

export interface SaveNewsIndexerMatchInput {
  predictionId: string
  /** The evidence set fed to the Oracle: [{ url, title, source, publishedDate }, ...]. */
  sources: Prisma.InputJsonValue
  externalProbability: number
  ciLow: number
  ciHigh: number
  oracleSnapshot: Prisma.InputJsonValue
  /** Oracle settlement detection: the outcome was reported as an accomplished fact. */
  settled?: boolean
}

/** externalReasoning marker identifying snapshots written by the news-indexer push path. */
const NEWS_INDEXER_REASONING = 'TruthMachine Oracle (news-indexer match)'

/**
 * Persist a news-indexer article match: creates a ContextSnapshot (no LLM summary)
 * and updates the prediction's probability fields.
 * Does NOT touch detailsText or contextUpdatedAt — preserves user-triggered context
 * and does not consume the 1-hour user cooldown.
 *
 * No dedup check here — the caller (news-indexer/context/route.ts) already
 * gates on `claimArticlesForExtraction` (evidence-pool.ts) before ever calling
 * the extractor, so this is only reached when at least one article in the
 * push is genuinely new or changed. That atomic, per-article claim replaced
 * this function's former findFirst-then-create dedup check, which compared
 * probability/oracleMean/source-URL-set against the latest snapshot — a
 * check-then-act race under news-indexer's at-least-once delivery (two
 * concurrent pushes could both pass it before either committed; confirmed in
 * prod as 7 near-simultaneous duplicate snapshots, 3 with conflicting stance).
 *
 * `stored` is always true; kept in the return shape so callers don't need a
 * second signature change on top of the dedup-removal.
 */
export async function saveNewsIndexerMatch(
  input: SaveNewsIndexerMatchInput,
): Promise<{ stored: boolean }> {
  await recordEstimate({
    predictionId: input.predictionId,
    origin: 'news-indexer',
    probability: input.externalProbability,
    ciLow: input.ciLow,
    ciHigh: input.ciHigh,
    settled: input.settled,
    sources: input.sources,
    externalReasoning: NEWS_INDEXER_REASONING,
    oracleSnapshot: input.oracleSnapshot,
  })
  return { stored: true }
}

/** Fetch the context snapshot timeline for a prediction (heavy tail stripped). */
export async function listContextSnapshots(predictionId: string) {
  const snapshots = await prisma.contextSnapshot.findMany({
    where: { predictionId, ...NOT_CLOCK },
    orderBy: { createdAt: 'desc' },
  })
  return stripHeavyTail(snapshots)
}

/**
 * The most recent context snapshot that carries an Oracle estimate, for a
 * forecast (= prediction). Used to surface the Oracle's analysed sources as
 * voters. Returns null when no analyze run has produced an oracleSnapshot.
 */
export async function getLatestOracleSnapshot(predictionId: string) {
  return prisma.contextSnapshot.findFirst({
    where: { predictionId, oracleSnapshot: { not: Prisma.DbNull }, ...NOT_CLOCK },
    orderBy: { createdAt: 'desc' },
    select: { oracleSnapshot: true, createdAt: true },
  })
}

/**
 * The anchor for the requote cron's glide: the most recent evidence-driven
 * (non-clock) snapshot that actually carries a probability and wasn't an
 * abstention. Deliberately NOT Prediction.confidence — the clock overwrites
 * that daily, so anchoring on it would compound the glide against itself.
 */
export async function getLatestEvidenceEstimate(
  predictionId: string,
): Promise<{ externalProbability: number; createdAt: Date } | null> {
  return prisma.contextSnapshot.findFirst({
    where: { predictionId, externalProbability: { not: null }, insufficientData: false, ...NOT_CLOCK },
    orderBy: { createdAt: 'desc' },
    select: { externalProbability: true, createdAt: true },
  }) as Promise<{ externalProbability: number; createdAt: Date } | null>
}

/**
 * The full AI-probability series for the history chart: every snapshot that
 * carries an estimate, INCLUDING kind='clock' glide requotes. This is the one
 * reader that deliberately crosses the NOT_CLOCK line — the timeline hides
 * clock rows as events, but the chart must show the glide as movement
 * (retro docs/ORACLE_VARIABLES.md §4.2 / §6). Ascending, light columns only.
 */
export async function getProbabilityHistory(predictionId: string) {
  return prisma.contextSnapshot.findMany({
    where: { predictionId, externalProbability: { not: null }, insufficientData: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true, externalProbability: true, kind: true },
  })
}

/**
 * Mark a forecast as Oracle-attempted when the Oracle produced no usable sources
 * (no articles / no estimate). Writes an empty oracleSnapshot marker so the backfill
 * stops re-selecting it (it now HAS a non-null oracleSnapshot) and the loop converges.
 * Touches nothing on the prediction — no estimate, no CI, no detailsText.
 */
export async function markOracleAttempted(predictionId: string, reason: string): Promise<void> {
  await recordEstimate({
    predictionId,
    origin: 'backfill',
    probability: null,
    externalReasoning: `TruthMachine Oracle (backfill: ${reason})`,
    oracleSnapshot: { sources: [], empty: true, reason },
  })
}

export interface SaveOracleSnapshotInput {
  predictionId: string
  /** The enriched Oracle source roster: EnrichedOracleSource[] under `{ sources }`. */
  oracleSnapshot: Prisma.InputJsonValue
  confidence: number | null
  aiCiLow: number | null
  aiCiHigh: number | null
  /** Oracle settlement detection: the outcome was reported as an accomplished fact. */
  settled?: boolean
}

/**
 * Persist ONLY an Oracle snapshot (for the active-forecast backfill): creates a
 * ContextSnapshot carrying the oracleSnapshot and refreshes the probability fields,
 * WITHOUT touching detailsText/contextUpdatedAt or translations — so it never
 * clobbers a user-written context summary. Mirrors saveNewsIndexerMatch.
 */
export async function saveOracleSnapshotOnly(input: SaveOracleSnapshotInput): Promise<void> {
  await recordEstimate({
    predictionId: input.predictionId,
    origin: 'backfill',
    // Funnel fix (ORACLE_VARIABLES.md §4.3 asymmetry 4): the backfill estimate now
    // lands on the snapshot too, so the chart and the glide anchor can see it.
    probability: input.confidence,
    ciLow: input.aiCiLow,
    ciHigh: input.aiCiHigh,
    settled: input.settled,
    externalReasoning: 'TruthMachine Oracle (active-forecast backfill)',
    oracleSnapshot: input.oracleSnapshot,
  })
}

export interface SaveClockSnapshotInput {
  predictionId: string
  probability: number
  aiCiLow: number | null
  aiCiHigh: number | null
  /** Clock provenance: { engineVersion, cause, pLast, tLast, tEff, c, direction }. */
  meta: Prisma.InputJsonValue
}

/**
 * The requote cron's writer (retro docs/TEMPORAL_MODEL_PLAN.md #4 Stage 0):
 * a kind='clock' snapshot + confidence/CI update, in one transaction. Never
 * calls notifyIfCrossedHighConfidence — cause-aware alerts mean a pure clock
 * crossing must not fire the "consider resolving" alert built for
 * settlement-grade news; never touches detailsText/translations/settled.
 */
export async function saveClockSnapshot(input: SaveClockSnapshotInput): Promise<void> {
  await recordEstimate({
    predictionId: input.predictionId,
    origin: 'clock',
    probability: input.probability,
    ciLow: input.aiCiLow,
    ciHigh: input.aiCiHigh,
    meta: input.meta,
  })
}
