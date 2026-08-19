import { Prisma, type ContextSnapshot } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { notifyHighConfidence } from '@/lib/services/telegram'
import { MATERIAL_CHANGE_PTS } from '@/lib/services/oracle-snapshot'

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

/** Settling votes a settlement pin must carry in its snapshot pool before the
 *  band or the crossing alert treats it as real (daatan#1248). Mirrors the
 *  Oracle's own `settlement_min_sources`, re-checked on our side of the wire
 *  because a pin's confidence is a *constant* (~97), not a level: it clears any
 *  level band by construction, whether it stands on two syndicated echoes or on
 *  a certified outcome. Counted from the persisted pool rows, so a pin arriving
 *  without its snapshot fails closed for band/alert purposes (the sticky
 *  `Prediction.settled` latch is untouched — that lane is notification-only by
 *  design, see #1301). */
const MIN_SETTLING_SOURCES = 2

/** Rows of the persisted Oracle pool that carried a settlement-grade vote.
 *  Defensive over unvalidated Json, same as `maxPublishedAt` below. */
function settlingSourceCount(oracleSnapshot: unknown): number {
  const sources = (oracleSnapshot as { sources?: unknown } | null | undefined)?.sources
  if (!Array.isArray(sources)) return 0
  return sources.filter((s) => (s as { settled?: unknown } | null)?.settled === true).length
}

/**
 * A settlement pin and an organic estimate are different epistemic classes
 * sharing the `confidence` column (daatan#1248): 97 from thirty agreeing
 * weighted sources is a level; 97 from a pin is `settlement_stance`, a policy
 * constant. So a pin enters the Awaiting Resolution band as what it is — the
 * Oracle's claim that the question is decided, admitted when the snapshot
 * carries at least MIN_SETTLING_SOURCES settling votes — and never via the
 * level check its constant would trivially clear. Organic estimates keep the
 * plain level band (the #1185 false-negative fix relies on that shape).
 */
function isAwaitingAiResolution(confidence: number | null, pinned = false, settlingSources = 0): boolean {
  if (pinned) return settlingSources >= MIN_SETTLING_SOURCES
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
  settlingSources = 0,
): void {
  if (prev === null || newConfidence === null) return
  if (newConfidence < HIGH_CONFIDENCE_THRESHOLD) return
  if (prev.confidence !== null && prev.confidence >= HIGH_CONFIDENCE_THRESHOLD) return
  // A pin's crossing is manufactured — settlement_stance is above the bar by
  // construction — so it alerts only when the pin is evidence-backed, under
  // the same bar the band applies (daatan#1248; the #388 false pin fired this
  // alert from two adjacent-fact votes).
  if (settled && settlingSources < MIN_SETTLING_SOURCES) {
    log.info({ predictionId, settlingSources }, 'high-confidence alert skipped: settlement pin below the settling-sources bar')
    return
  }
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
  /** The run abstained: records the snapshot as an abstention. Whether the
   *  prediction's published needle + band are cleared or left standing is decided
   *  from `insufficientReason` — see `CLEARING_ABSTAIN_REASONS` (daatan#1473). */
  insufficientData?: boolean
  /** Why the run abstained (`all_articles_off_topic`, `no_usable_weight`,
   *  `oracle_abstain`, …). Drives the clear-vs-preserve decision above, and is
   *  persisted on the snapshot so the abstention stays diagnosable afterwards. */
  insufficientReason?: string | null
  /** How many pool rows the abstaining aggregate saw. Diagnostics only — persisted
   *  beside `insufficientReason`, read by nothing. */
  poolSize?: number | null
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

/** Max parseable `publishedAt`/`publishedDate` across a JSON array of sources, else null.
 *  Defensive: this is externally-sourced, unvalidated Json (retro's pool rows, news-indexer's
 *  push payload) — a missing/malformed date on one row must not fail the whole extraction. */
function maxPublishedAt(values: unknown): Date | null {
  if (!Array.isArray(values)) return null
  let max: Date | null = null
  for (const v of values) {
    const raw = (v as { publishedAt?: unknown; publishedDate?: unknown } | null)?.publishedAt
      ?? (v as { publishedAt?: unknown; publishedDate?: unknown } | null)?.publishedDate
    if (typeof raw !== 'string') continue
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) continue
    if (max === null || d > max) max = d
  }
  return max
}

/**
 * F17 (daatan#1236): the newest evidence-publish time behind an estimate — prefers
 * the full weight-bearing pool (`oracleSnapshot.sources[].publishedAt`, EnrichedOracleSource
 * shape) over the narrower push payload (`sources[].publishedDate`), since the pool is what
 * the estimate actually averages. Null when neither yields a parseable date — callers fall
 * back to write time.
 */
function evidencePublishedAt(sources: unknown, oracleSnapshot: unknown): Date | null {
  const poolSources = (oracleSnapshot as { sources?: unknown } | null | undefined)?.sources
  return maxPublishedAt(poolSources) ?? maxPublishedAt(sources)
}

/**
 * Abstention reasons that CLEAR the published estimate instead of leaving it standing.
 *
 * An abstention says *this run* found no usable evidence. It is not a verdict on the
 * number already published: that number came out of a pool which only ever grows, so a
 * forecast holding a real estimate cannot honestly become "every article off-topic" a
 * moment later. Nulling `confidence`/`aiCiLow`/`aiCiHigh` on it destroys valid data —
 * daatan#1473, where one `analyze` run wiped a 115-article, settlement-verifier-approved
 * 97% and left the forecast showing no estimate at all for ~23 h, with no self-heal until
 * some later pool write happened to touch the row.
 *
 * The default is therefore PRESERVE: the abstention is recorded as a snapshot (which is
 * what the UI reads — `ContextSnapshot.insufficientData`, `ForecastDetailClient`), and the
 * prediction's needle + band are left exactly as any other run that produced no number
 * leaves them.
 *
 * This set is the declared exception: an abstention that IS a verdict on the prior
 * estimate — a pool-staleness abstention (retro#416's valve), where "the evidence behind
 * that number has decayed" means the number must go. No such reason exists today, hence
 * the empty set. The tempting alternative — clear whenever the pool looks thin — would
 * make that valve inert on exactly its target population (a large pool carrying a prior
 * confidence), which is why the discrimination is by reason and not by size. Unknown
 * reasons fall through to preserve on purpose: destroying a published number on a reason
 * we do not recognise is the wrong default.
 *
 * Exported so the policy test can pin both branches — adding a reason here must make it
 * clear, and the set must stay empty until a reason of that kind actually ships.
 */
export const CLEARING_ABSTAIN_REASONS = new Set<string>()

function abstentionClearsEstimate(reason: string | null | undefined): boolean {
  return reason != null && CLEARING_ABSTAIN_REASONS.has(reason)
}

/**
 * Persist one AI-estimate write — any origin — as a ContextSnapshot plus a
 * consistent Prediction update, in a single transaction.
 *
 * Invariants (uniform across origins, unlike the five pre-funnel writers):
 * - the snapshot always carries `origin`, `articlesUsed`, and its probability;
 * - `confidence` and `aiCiLow/aiCiHigh` move atomically — both written (with
 *   `awaitingAiResolution` recomputed), both cleared on an abstention whose reason
 *   says the prior number is itself unsupportable, or both left alone (the ordinary
 *   abstention, and any run that produced no number);
 * - the settled latch and all notifications are decided here, per origin policy.
 */
export async function recordEstimate(input: RecordEstimateInput) {
  const policy = ORIGIN_POLICY[input.origin]
  const now = input.now ?? new Date()

  const willNotify = policy.notifyOnCrossing && !input.insufficientData && input.probability !== null
  const prev = willNotify ? await readPreviousConfidence(input.predictionId) : null

  // F17 (daatan#1236): only an evidence-kind write with an actual probability is a
  // candidate anchor at all (abstentions/no-number writes are already excluded from
  // getLatestEvidenceEstimate by its own WHERE clause) — compute whether it moved
  // enough from the CURRENT anchor to count as new information, and when the
  // evidence behind it was actually published. Clock writes never anchor (NOT_CLOCK),
  // so neither field matters for them; both keep the safe (anchor-eligible) default.
  let materialChange = true
  let evidenceAt: Date | null = null
  if (policy.kind === 'evidence' && !input.insufficientData && input.probability !== null) {
    const anchor = await getLatestEvidenceEstimate(input.predictionId)
    materialChange = anchor === null || Math.abs(input.probability - anchor.externalProbability) >= MATERIAL_CHANGE_PTS
    evidenceAt = evidencePublishedAt(input.sources, input.oracleSnapshot)
  }

  // Settlement is honored only where the origin may carry it (the same
  // policy.canSettle the sticky latch obeys) — a clock or creation write
  // claiming `settled` must not buy its way into the band or the alert.
  const pinned = policy.canSettle && input.settled === true
  const settlingSources = pinned ? settlingSourceCount(input.oracleSnapshot) : 0

  // An abstention leaves the published estimate alone unless its reason condemns it
  // (daatan#1473) — `{}` here is the same "this run produced no number" no-op the
  // `probability === null` branch below takes, so needle, band and awaitingAiResolution
  // all stay consistent with each other rather than being half-cleared.
  const estimateFields: Prisma.PredictionUpdateInput = input.insufficientData
    ? abstentionClearsEstimate(input.insufficientReason)
      ? { confidence: null, aiCiLow: null, aiCiHigh: null, awaitingAiResolution: false }
      : {}
    : input.probability !== null
      ? {
          confidence: input.probability,
          awaitingAiResolution: isAwaitingAiResolution(input.probability, pinned, settlingSources),
          aiCiLow: input.ciLow ?? null,
          aiCiHigh: input.ciHigh ?? null,
        }
      : {}
  const predictionData: Prisma.PredictionUpdateInput = {
    ...estimateFields,
    ...(policy.canSettle && input.settled ? { settled: true, settledAt: now } : {}),
    ...(policy.touchesUserContext ? { detailsText: input.summary ?? '', contextUpdatedAt: now } : {}),
  }

  // Abstention diagnostics (daatan#1473): every abstain path already produced a reason
  // and a pool size and then only LOGGED them, so "why did analyze abstain on a
  // 115-article pool?" could not be answered from the data at all. `meta` is otherwise
  // clock-only and read by nothing, so recording them here costs no migration.
  const abstainMeta: Prisma.InputJsonValue | undefined = input.insufficientData
    ? { abstain: { reason: input.insufficientReason ?? null, poolSize: input.poolSize ?? null } }
    : undefined

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
        meta: input.meta ?? abstainMeta ?? undefined,
        articlesUsed: articlesUsedOf(input.oracleSnapshot),
        materialChange,
        evidenceAt,
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
    notifyIfCrossedHighConfidence(input.predictionId, prev, input.probability, pinned, settlingSources)
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
   *  as an abstention; the prediction's last published number is LEFT STANDING unless
   *  `insufficientReason` condemns it (daatan#1473 — see `CLEARING_ABSTAIN_REASONS`).
   *  The gauge shows "Insufficient evidence" off the snapshot either way. */
  insufficientData?: boolean
  /** Why the run abstained — persisted, and the clear-vs-preserve switch above. */
  insufficientReason?: string | null
  /** Pool rows behind the abstaining aggregate; diagnostics only. */
  poolSize?: number | null
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
    insufficientReason: input.insufficientReason,
    poolSize: input.poolSize,
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
  /** Null on an abstention (`insufficientData`) — the whole pool was off-topic, so this run
   *  has no estimate to persist. The prediction's existing confidence/CI survive it
   *  (daatan#1473); only a condemning `insufficientReason` clears them. */
  externalProbability: number | null
  ciLow: number | null
  ciHigh: number | null
  oracleSnapshot: Prisma.InputJsonValue
  /** Oracle settlement detection: the outcome was reported as an accomplished fact. */
  settled?: boolean
  /** The pool aggregated but found no usable signal (off-topic). Records an abstention:
   *  snapshot flagged, no notification, excluded from glide/chart — and the prediction's
   *  published confidence/CI left alone (daatan#1473). */
  insufficientData?: boolean
  /** Why the pool abstained (`all_articles_off_topic`, `no_usable_weight`, …). */
  insufficientReason?: string | null
  /** Pool rows behind the abstaining aggregate; diagnostics only. */
  poolSize?: number | null
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
 * second signature change on top of the dedup-removal. `contextSnapshotId` is
 * the created row's id — the manual number-rating feedback loop (daatan#1223)
 * references it as a frozen, point-in-time source for the numbers a Telegram
 * rating-prompt message showed, since ContextSnapshot rows are never mutated
 * after creation.
 */
export async function saveNewsIndexerMatch(
  input: SaveNewsIndexerMatchInput,
): Promise<{ stored: boolean; contextSnapshotId: string }> {
  const snapshot = await recordEstimate({
    predictionId: input.predictionId,
    origin: 'news-indexer',
    probability: input.externalProbability,
    ciLow: input.ciLow,
    ciHigh: input.ciHigh,
    settled: input.settled,
    insufficientData: input.insufficientData,
    insufficientReason: input.insufficientReason,
    poolSize: input.poolSize,
    sources: input.sources,
    externalReasoning: NEWS_INDEXER_REASONING,
    oracleSnapshot: input.oracleSnapshot,
  })
  return { stored: true, contextSnapshotId: snapshot.id }
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
 * (non-clock) snapshot that actually carries a probability, wasn't an
 * abstention, and was MATERIAL (F17, daatan#1236) — its probability moved
 * meaningfully from the anchor before it, so it carries new information.
 * A same-probability re-write (e.g. a push whose only article was
 * gatekeeper-rejected, recomputing an otherwise-unchanged pool) still gets
 * written by `recordEstimate` — no check-then-act dedup — but is excluded
 * here so it can't reset the glide clock. Deliberately NOT Prediction.confidence
 * — the clock overwrites that daily, so anchoring on it would compound the
 * glide against itself.
 *
 * Returns the anchor's CI for exactly that reason (daatan#1489): the band used to
 * be glided from Prediction.aiCiLow/aiCiHigh, which is the very compounding this
 * docstring warns about, one field over. The band now anchors here with the point.
 */
export interface EvidenceAnchor {
  externalProbability: number
  createdAt: Date
  evidenceAt: Date | null
  /** The band the pool published alongside `externalProbability`, percent 0-100.
   *  Read from oracleSnapshot (ContextSnapshot has no CI column) so the glide can
   *  anchor the band the same way it anchors the point — daatan#1489. Null on the
   *  rare legacy snapshot whose oracleSnapshot predates these keys. */
  ciLow: number | null
  ciHigh: number | null
  /** Did the pool that produced this anchor assert settlement? Only the clock reads
   *  it (daatan#1498). A settlement-asserting snapshot is supposed to have latched
   *  `Prediction.settled`, which takes the forecast out of the clock's candidate set
   *  entirely — so seeing this true on a candidate means the latch is missing, and
   *  the clock would otherwise glide a settlement pin as if it were an estimate. */
  settled: boolean
}

export async function getLatestEvidenceEstimate(predictionId: string): Promise<EvidenceAnchor | null> {
  const snap = await prisma.contextSnapshot.findFirst({
    where: {
      predictionId,
      externalProbability: { not: null },
      insufficientData: false,
      materialChange: true,
      ...NOT_CLOCK,
    },
    orderBy: { createdAt: 'desc' },
    select: { externalProbability: true, createdAt: true, evidenceAt: true, oracleSnapshot: true },
  })
  if (snap === null) return null
  const oracle = snap.oracleSnapshot as { ciLow?: unknown; ciHigh?: unknown; settled?: unknown } | null
  return {
    externalProbability: snap.externalProbability as number,
    createdAt: snap.createdAt,
    evidenceAt: snap.evidenceAt,
    ciLow: typeof oracle?.ciLow === 'number' ? oracle.ciLow : null,
    ciHigh: typeof oracle?.ciHigh === 'number' ? oracle.ciHigh : null,
    settled: oracle?.settled === true,
  }
}

/**
 * The probability the settlement pin published: `externalProbability` of the most
 * recent non-clock snapshot asserting settlement.
 *
 * Neither field on the prediction row can stand in for it. `Prediction.confidence`
 * is the *current* number, which is the thing being compared against. `settledAt`
 * is not the pin's date either — `recordEstimate` re-stamps it on every settled
 * write, so it marks the last one (daatan#1498). The pin's value is only ever
 * recorded inside the snapshot that carried it.
 */
export async function getSettlementPinProbability(predictionId: string): Promise<number | null> {
  const snap = await prisma.contextSnapshot.findFirst({
    where: {
      predictionId,
      externalProbability: { not: null },
      insufficientData: false,
      oracleSnapshot: { path: ['settled'], equals: true },
      ...NOT_CLOCK,
    },
    orderBy: { createdAt: 'desc' },
    select: { externalProbability: true },
  })
  return snap?.externalProbability ?? null
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
  /** The pool aggregated but found no usable signal (off-topic) — records an abstention,
   *  leaving any published confidence/CI standing (daatan#1473). */
  insufficientData?: boolean
  /** Why the pool abstained (`all_articles_off_topic`, `no_usable_weight`, …). */
  insufficientReason?: string | null
  /** Pool rows behind the abstaining aggregate; diagnostics only. */
  poolSize?: number | null
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
    insufficientData: input.insufficientData,
    insufficientReason: input.insufficientReason,
    poolSize: input.poolSize,
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
