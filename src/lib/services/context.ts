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
 *  Oracul's own `settlement_min_sources`, re-checked on our side of the wire
 *  because a pin's confidence is a *constant* (~97), not a level: it clears any
 *  level band by construction, whether it stands on two syndicated echoes or on
 *  a certified outcome. Counted from the persisted pool rows, so a pin arriving
 *  without its snapshot fails closed for band/alert purposes (the sticky
 *  `Prediction.settled` latch is untouched — that lane is notification-only by
 *  design, see #1301). */
const MIN_SETTLING_SOURCES = 2

/** The other half of the bar (daatan#1525). A bare count is confounded with pool
 *  size: measured on prod, `settling = 2` covers both 2-of-2 (unanimous) and
 *  2-of-97 (2% agreement), and the count floor rises with the pool, so raising the
 *  integer mostly rejects SMALL pools — including the unanimous ones, which are the
 *  strongest evidence the pipeline produces. Requiring a share instead rejects
 *  2-of-97 and keeps 2-of-2; the count floor above is what stops a pure share test
 *  clearing on a 1-of-1 pool. Integer arithmetic on purpose — `settling * 4 >= total`
 *  is `settling / total >= 0.25` without the float. */
const MIN_SETTLING_SHARE_DENOM = 4

/** Rows of the persisted Oracul pool that carried a settlement-grade vote.
 *  Defensive over unvalidated Json, same as `maxPublishedAt` below. */
function settlingSourceCount(oracleSnapshot: unknown): number {
  const sources = (oracleSnapshot as { sources?: unknown } | null | undefined)?.sources
  if (!Array.isArray(sources)) return 0
  return sources.filter((s) => (s as { settled?: unknown } | null)?.settled === true).length
}

/** Pool rows behind an estimate, settling or not — the denominator of the share. */
function sourceCount(oracleSnapshot: unknown): number {
  const sources = (oracleSnapshot as { sources?: unknown } | null | undefined)?.sources
  return Array.isArray(sources) ? sources.length : 0
}

/**
 * Does this snapshot's pool actually back the Oracul's settlement claim?
 *
 * One predicate for all three consumers — latch, band and crossing alert — because
 * they used to disagree (daatan#1525). The latch, which excludes a forecast from the
 * temporal clock's glide candidates, shows a settled badge and can only be undone by
 * a human, had NO bar at all, while the two lighter consumers both applied
 * MIN_SETTLING_SOURCES. 195 assertions carrying fewer than two settling votes were
 * written on prod (107 with zero) — every one of them free to latch while the alert
 * that would have reported it was suppressed as too weak.
 *
 * Fails closed on a pin that arrives without its snapshot: no pool, no backing.
 */
function settlementBacking(oracleSnapshot: unknown): { settling: number; total: number; backed: boolean } {
  const settling = settlingSourceCount(oracleSnapshot)
  const total = sourceCount(oracleSnapshot)
  return {
    settling,
    total,
    backed: settling >= MIN_SETTLING_SOURCES && settling * MIN_SETTLING_SHARE_DENOM >= total,
  }
}

/**
 * A settlement pin and an organic estimate are different epistemic classes
 * sharing the `confidence` column (daatan#1248): 97 from thirty agreeing
 * weighted sources is a level; 97 from a pin is `settlement_stance`, a policy
 * constant. So a pin enters the Awaiting Resolution band as what it is — the
 * Oracul's claim that the question is decided, admitted only when the snapshot's
 * pool actually backs it (`settlementBacking`) — and never via the level check its
 * constant would trivially clear. Organic estimates keep the plain level band (the
 * #1185 false-negative fix relies on that shape).
 */
function isAwaitingAiResolution(confidence: number | null, pinned = false, backed = false): boolean {
  if (pinned) return backed
  return confidence !== null && (confidence >= AWAITING_AI_RESOLUTION_HIGH || confidence <= AWAITING_AI_RESOLUTION_LOW)
}

/** A human dismissal from Awaiting Resolution (daatan#1659) holds while the new
 *  estimate stays within this many points of the number the human dismissed. */
export const AWAITING_DISMISSAL_STICKY_PTS = 5

interface AwaitingDismissal {
  awaitingDismissedAt: Date | null
  awaitingDismissedConfidence: number | null
}

/**
 * Apply a standing human dismissal to a freshly computed `awaitingAiResolution`.
 * Returns the flag to write plus whether the dismissal survives this write. The
 * dismissal is forgotten as soon as the estimate moves more than
 * AWAITING_DISMISSAL_STICKY_PTS from what the human saw — in either direction —
 * because at that point they have not seen this number.
 */
export function applyAwaitingDismissal(
  computed: boolean,
  confidence: number,
  dismissal: AwaitingDismissal | null,
): { awaitingAiResolution: boolean; keepDismissal: boolean } {
  if (!dismissal?.awaitingDismissedAt || dismissal.awaitingDismissedConfidence === null) {
    return { awaitingAiResolution: computed, keepDismissal: false }
  }
  const moved = Math.abs(confidence - dismissal.awaitingDismissedConfidence) > AWAITING_DISMISSAL_STICKY_PTS
  if (moved) return { awaitingAiResolution: computed, keepDismissal: false }
  return { awaitingAiResolution: false, keepDismissal: true }
}

async function readAwaitingDismissal(predictionId: string): Promise<AwaitingDismissal | null> {
  return prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { awaitingDismissedAt: true, awaitingDismissedConfidence: true },
  })
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
  backed = false,
): void {
  if (prev === null || newConfidence === null) return
  if (newConfidence < HIGH_CONFIDENCE_THRESHOLD) return
  if (prev.confidence !== null && prev.confidence >= HIGH_CONFIDENCE_THRESHOLD) return
  // A pin's crossing is manufactured — settlement_stance is above the bar by
  // construction — so it alerts only when the pin is evidence-backed, under
  // the same bar the band applies (daatan#1248; the #388 false pin fired this
  // alert from two adjacent-fact votes).
  if (settled && !backed) {
    log.info({ predictionId }, 'high-confidence alert skipped: settlement pin below the settling-source bar')
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

export type EstimateOrigin = 'creation' | 'analyze' | 'news-indexer' | 'backfill' | 'republish' | 'clock'

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
  // The admin re-publish tool (daatan#1508). `canSettle: false` is load-bearing: an
  // operator tool must never pin a forecast — if the pool genuinely settles, the
  // ordinary push path will latch it. `kind: 'evidence'` so the write anchors the
  // temporal clock, which is half the point of re-publishing over a stale anchor.
  republish: { kind: 'evidence', notifyOnCrossing: true, canSettle: false, touchesUserContext: false },
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
  /** Oracul settlement detection; honored only where the origin policy allows. */
  settled?: boolean
  summary?: string
  sources?: Prisma.InputJsonValue
  externalReasoning?: string | null
  oracleSnapshot?: Prisma.InputJsonValue | null
  /** Clock provenance JSON (origin='clock' only). */
  meta?: Prisma.InputJsonValue
  /** Pool-aggregate diagnostics (retro#458 Phase 2) when this estimate came from
   *  `resolvePooledEstimate`'s pool path — null/omitted on the single-run and
   *  pool-insufficient outcomes. Persisted alongside `abstainMeta`; read by
   *  nothing yet (daatan#1563). */
  evidenceMass?: number | null
  nEff?: number | null
  ageAdjustedMass?: number | null
  /** Which engine produced this estimate ('v1' | 'v2') and the wire schema
   *  version it arrived on — retro's `Provenance.engine`/`Provenance.schema_version`
   *  (daatan#1617). Plumbing only: no caller passes 'v2' today (gated on
   *  M4/daatan#1558), so omitting these leaves the DB default ('v1') in force —
   *  see `ContextSnapshot.engine` in prisma/schema.prisma. */
  engine?: string | null
  schemaVersion?: string | null
  now?: Date
}

/** Oracul articles_used out of the snapshot payload, else null (LLM fallback, clock). */
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
  const backing = pinned
    ? settlementBacking(input.oracleSnapshot)
    : { settling: 0, total: 0, backed: false }
  if (pinned && !backing.backed) {
    // Visible from day one rather than inferred later: this is the rate at which the
    // Oracul claims settlement on a pool that does not carry it (daatan#1525).
    log.info(
      { predictionId: input.predictionId, origin: input.origin, ...backing },
      'settlement pin rejected: pool does not back the claim, latch not written',
    )
  }
  // Deliberately the *truthy* test, not `pinned`'s strict one: this mirrors the
  // condition the latch spread below actually uses, so the post-write check can
  // never disagree with the write it is checking (daatan#1498).
  const latchWrite = pinned && backing.backed

  // An abstention leaves the published estimate alone unless its reason condemns it
  // (daatan#1473) — `{}` here is the same "this run produced no number" no-op the
  // `probability === null` branch below takes, so needle, band and awaitingAiResolution
  // all stay consistent with each other rather than being half-cleared.
  const estimateFields: Prisma.PredictionUpdateInput = input.insufficientData
    ? abstentionClearsEstimate(input.insufficientReason)
      ? { confidence: null, aiCiLow: null, aiCiHigh: null, awaitingAiResolution: false }
      : {}
    : input.probability !== null
      ? await (async () => {
          const computed = isAwaitingAiResolution(input.probability as number, pinned, backing.backed)
          // Only a write that would put the forecast INTO the queue can be overridden
          // by a standing dismissal, so that is the only time the extra read is paid.
          const dismissal = computed ? await readAwaitingDismissal(input.predictionId) : null
          const applied = applyAwaitingDismissal(computed, input.probability as number, dismissal)
          return {
            confidence: input.probability,
            awaitingAiResolution: applied.awaitingAiResolution,
            aiCiLow: input.ciLow ?? null,
            aiCiHigh: input.ciHigh ?? null,
            ...(applied.keepDismissal || !dismissal?.awaitingDismissedAt
              ? {}
              : { awaitingDismissedAt: null, awaitingDismissedConfidence: null }),
          }
        })()
      : {}
  const predictionData: Prisma.PredictionUpdateInput = {
    ...estimateFields,
    ...(latchWrite ? { settled: true, settledAt: now } : {}),
    ...(policy.touchesUserContext ? { detailsText: input.summary ?? '', contextUpdatedAt: now } : {}),
  }

  // Abstention diagnostics (daatan#1473): every abstain path already produced a reason
  // and a pool size and then only LOGGED them, so "why did analyze abstain on a
  // 115-article pool?" could not be answered from the data at all. `meta` is otherwise
  // clock-only and read by nothing, so recording them here costs no migration.
  const abstainMeta = input.insufficientData
    ? { abstain: { reason: input.insufficientReason ?? null, poolSize: input.poolSize ?? null } }
    : undefined

  const poolMeta =
    input.evidenceMass != null || input.nEff != null || input.ageAdjustedMass != null
      ? { pool: { evidenceMass: input.evidenceMass ?? null, nEff: input.nEff ?? null, ageAdjustedMass: input.ageAdjustedMass ?? null } }
      : undefined

  const computedMeta: Prisma.InputJsonValue | undefined =
    abstainMeta || poolMeta ? ({ ...abstainMeta, ...poolMeta } as Prisma.InputJsonValue) : undefined

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
        meta: input.meta ?? computedMeta ?? undefined,
        articlesUsed: articlesUsedOf(input.oracleSnapshot),
        materialChange,
        evidenceAt,
        // `?? undefined`, not `?? null`: an omitted `engine` must leave the column's
        // DB default ('v1') in force rather than overwriting it with an explicit NULL
        // (daatan#1617) — same convention `oracleSnapshot` above already uses.
        engine: input.engine ?? undefined,
        schemaVersion: input.schemaVersion ?? undefined,
      },
    }),
  ]
  let predictionOpIndex = -1
  if (Object.keys(predictionData).length > 0) {
    predictionOpIndex = ops.length
    ops.push(prisma.prediction.update({ where: { id: input.predictionId }, data: predictionData }))
  }
  if (policy.touchesUserContext) {
    // This write overwrites the English summary — cached he/ru/eo translations
    // are now stale; dropping them makes SSR fall back until re-translation.
    ops.push(prisma.predictionTranslation.deleteMany({
      where: { predictionId: input.predictionId, fieldName: 'detailsText' },
    }))
  }

  const results = await prisma.$transaction(ops)
  const snapshot = results[0]
  // The latch and `confidence` ride the SAME update, in the same transaction as the
  // snapshot — so a settlement-asserting write that leaves `settled` false means the
  // two diverged inside one statement, which the source says cannot happen. It did:
  // 24 predictions hold 1,036 settlement-asserting snapshots with the latch unset,
  // and no log line from that era survived to say how (daatan#1498). The update
  // already returns the row it wrote, so checking it costs nothing and turns the next
  // occurrence into a dated, attributable record instead of archaeology.
  if (latchWrite && (results[predictionOpIndex] as { settled?: boolean } | undefined)?.settled !== true) {
    log.error(
      {
        predictionId: input.predictionId,
        origin: input.origin,
        probability: input.probability,
        snapshotId: (snapshot as ContextSnapshot).id,
      },
      'settlement latch did not stick: asked for settled=true and the row came back false (daatan#1498)',
    )
  }
  if (willNotify) {
    notifyIfCrossedHighConfidence(input.predictionId, prev, input.probability, pinned, backing.backed)
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
 *
 * Also drops the forecast out of the "Awaiting Resolution" queue (daatan#1655):
 * `awaitingAiResolution` is otherwise only recomputed on the next estimate write, so
 * a human clear left the forecast sitting in `/?status=PENDING` — which is where the
 * admin found it in the first place. The temporal clock's settled-drift / unlatched-
 * pin alert stamps are nulled for the same reason (they re-arm on their own). The
 * next requote still re-flags it if the bare probability is ≥90% / ≤10% — by design.
 */
export async function clearSettledLatch(predictionId: string, clearedBy: string, now = new Date()): Promise<void> {
  const current = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { confidence: true },
  })
  await prisma.prediction.update({
    where: { id: predictionId },
    // `settledAt` keeps its meaning — the last settled *write*, hence nulled here —
    // but the clear itself is now recorded (daatan#1498). Without these two columns a
    // cleared forecast is byte-identical to one that never latched, which is why
    // "did the latch fire and get cleared, or never fire?" could not be answered for
    // 24 predictions from the data alone.
    data: {
      settled: false,
      settledAt: null,
      settledClearedAt: now,
      settledClearedBy: clearedBy,
      awaitingAiResolution: false,
      settledDriftAlertAt: null,
      unlatchedPinAlertAt: null,
      // Sticky (daatan#1659): a clear that the next requote silently re-flags is no clear.
      awaitingDismissedAt: now,
      awaitingDismissedConfidence: current?.confidence ?? null,
    },
  })
  log.info({ predictionId, clearedBy }, 'settled latch cleared')
}

/**
 * Human dismissal from the Awaiting Resolution queue (daatan#1659) — for a forecast
 * the AI is confident about but a human has looked at and decided is not resolvable
 * yet. Clears the flag and the clock's alert stamps now, and remembers the number
 * the human saw so `recordEstimate` keeps the forecast out of the queue until the
 * estimate actually moves (see `applyAwaitingDismissal`).
 */
export async function dismissAwaitingResolution(predictionId: string, dismissedBy: string, now = new Date()): Promise<void> {
  const current = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { confidence: true },
  })
  await prisma.prediction.update({
    where: { id: predictionId },
    data: {
      awaitingAiResolution: false,
      settledDriftAlertAt: null,
      unlatchedPinAlertAt: null,
      awaitingDismissedAt: now,
      awaitingDismissedConfidence: current?.confidence ?? null,
    },
  })
  log.info({ predictionId, dismissedBy, confidence: current?.confidence ?? null }, 'awaiting-resolution dismissed')
}

/** Keep the heavy JSON (`sources[]` + `oracleSnapshot`) only for this many most-recent
 *  snapshots; older timeline rows are returned light. Bounds a payload that would
 *  otherwise grow with a forecast's entire update history. */
const CONTEXT_TIMELINE_HEAVY_LIMIT = 25

/** Every ContextSnapshot column except the JSON blobs (`sources`, `oracleSnapshot` and
 *  its per-source `sourcesSummary` mirror). The two scalar mirrors are narrow, so they ride
 *  along. */
const LIGHT_SNAPSHOT_SELECT = {
  id: true,
  predictionId: true,
  summary: true,
  externalProbability: true,
  externalReasoning: true,
  insufficientData: true,
  kind: true,
  origin: true,
  meta: true,
  articlesUsed: true,
  materialChange: true,
  evidenceAt: true,
  engine: true,
  schemaVersion: true,
  createdAt: true,
  oracleSettled: true,
  oracleMean: true,
} satisfies Prisma.ContextSnapshotSelect

/**
 * A forecast's non-clock snapshots newest-first: the `CONTEXT_TIMELINE_HEAVY_LIMIT` most
 * recent rows in full, every older row without its `sources[]` / `oracleSnapshot` blobs.
 * The probability chart reads only `createdAt` + `externalProbability`, so its full
 * history is untouched — only a deep-scrolled timeline row loses its source chips.
 *
 * Two statements instead of one plus an in-memory strip: `oracle_snapshot` averages
 * ~60 kB per row on prod (128 MB for the largest forecast), and Postgres detoasts every
 * blob it returns, so the strip used to run after the whole history had already been
 * read and shipped. The tail query never names the JSON columns, so they are never read.
 * The tail is keyed on the head's last row (not `skip`), so a snapshot inserted between
 * the two statements cannot duplicate or drop a row at the boundary.
 */
async function loadTimelineSnapshots(predictionId: string): Promise<ContextSnapshot[]> {
  const head = await prisma.contextSnapshot.findMany({
    where: { predictionId, ...NOT_CLOCK },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CONTEXT_TIMELINE_HEAVY_LIMIT,
  })
  if (head.length < CONTEXT_TIMELINE_HEAVY_LIMIT) return head
  const tail = await prisma.contextSnapshot.findMany({
    where: { predictionId, ...NOT_CLOCK },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    cursor: { id: head[head.length - 1].id },
    skip: 1,
    select: LIGHT_SNAPSHOT_SELECT,
  })
  return [
    ...head,
    ...tail.map((snap): ContextSnapshot => ({ ...snap, sources: [], oracleSnapshot: null, sourcesSummary: null })),
  ]
}

/** Fetch prediction with context snapshots for the GET timeline endpoint. */
export async function getContextTimeline(idOrSlug: string) {
  const prediction = await prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, detailsText: true, contextUpdatedAt: true },
  })
  if (!prediction) return prediction
  return { ...prediction, contextSnapshots: await loadTimelineSnapshots(prediction.id) }
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
  /** The Oracul abstained — no evidence bears on the claim. Records the snapshot
   *  as an abstention; the prediction's last published number is LEFT STANDING unless
   *  `insufficientReason` condemns it (daatan#1473 — see `CLEARING_ABSTAIN_REASONS`).
   *  The gauge shows "Insufficient evidence" off the snapshot either way. */
  insufficientData?: boolean
  /** Why the run abstained — persisted, and the clear-vs-preserve switch above. */
  insufficientReason?: string | null
  /** Pool rows behind the abstaining aggregate; diagnostics only. */
  poolSize?: number | null
  /** Pool-aggregate diagnostics (retro#458 Phase 2); see `RecordEstimateInput`. */
  evidenceMass?: number | null
  nEff?: number | null
  ageAdjustedMass?: number | null
  /** Provenance passthrough (daatan#1617); see `RecordEstimateInput.engine`/`.schemaVersion`. */
  engine?: string | null
  schemaVersion?: string | null
  /** Oracul settlement detection: the outcome was reported as an accomplished fact. */
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
    evidenceMass: input.evidenceMass,
    nEff: input.nEff,
    ageAdjustedMass: input.ageAdjustedMass,
    engine: input.engine,
    schemaVersion: input.schemaVersion,
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
  /** The evidence set fed to the Oracul: [{ url, title, source, publishedDate }, ...]. */
  sources: Prisma.InputJsonValue
  /** Null on an abstention (`insufficientData`) — the whole pool was off-topic, so this run
   *  has no estimate to persist. The prediction's existing confidence/CI survive it
   *  (daatan#1473); only a condemning `insufficientReason` clears them. */
  externalProbability: number | null
  ciLow: number | null
  ciHigh: number | null
  oracleSnapshot: Prisma.InputJsonValue
  /** Oracul settlement detection: the outcome was reported as an accomplished fact. */
  settled?: boolean
  /** The pool aggregated but found no usable signal (off-topic). Records an abstention:
   *  snapshot flagged, no notification, excluded from glide/chart — and the prediction's
   *  published confidence/CI left alone (daatan#1473). */
  insufficientData?: boolean
  /** Why the pool abstained (`all_articles_off_topic`, `no_usable_weight`, …). */
  insufficientReason?: string | null
  /** Pool rows behind the abstaining aggregate; diagnostics only. */
  poolSize?: number | null
  /** Pool-aggregate diagnostics (retro#458 Phase 2); see `RecordEstimateInput`. */
  evidenceMass?: number | null
  nEff?: number | null
  ageAdjustedMass?: number | null
  /** Provenance passthrough (daatan#1617); see `RecordEstimateInput.engine`/`.schemaVersion`. */
  engine?: string | null
  schemaVersion?: string | null
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
    evidenceMass: input.evidenceMass,
    nEff: input.nEff,
    ageAdjustedMass: input.ageAdjustedMass,
    engine: input.engine,
    schemaVersion: input.schemaVersion,
    sources: input.sources,
    externalReasoning: NEWS_INDEXER_REASONING,
    oracleSnapshot: input.oracleSnapshot,
  })
  return { stored: true, contextSnapshotId: snapshot.id }
}

/** Fetch the context snapshot timeline for a prediction (heavy tail stripped). */
export async function listContextSnapshots(predictionId: string) {
  return loadTimelineSnapshots(predictionId)
}

/**
 * The most recent context snapshot that carries an Oracul estimate, for a
 * forecast (= prediction). Used to surface the Oracul's analysed sources as
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
      oracleSettled: true,
      ...NOT_CLOCK,
    },
    orderBy: { createdAt: 'desc' },
    select: { externalProbability: true },
  })
  return snap?.externalProbability ?? null
}

/**
 * Non-null when the forecast's CURRENT evidence position asserts settlement: the
 * newest non-clock, non-abstaining snapshot is itself the one carrying
 * `oracleSnapshot.settled`. Paired with `Prediction.settled === false` that is the
 * live half of daatan#1498 — the pipeline says "decided" while the row says
 * otherwise, so the forecast shows no settled badge, stays a glide candidate, and is
 * invisible to #1490's sweep, which selects on the latch.
 *
 * Deliberately "the newest snapshot happens to assert" rather than "the newest
 * assertion", which is what `getSettlementPinProbability` above answers. A forecast
 * that asserted settlement in July and has published unsettled numbers ever since is
 * not in an anomalous state — it moved on, and re-raising it would page for history.
 * Identity comparison rather than timestamps: two snapshots can share a `createdAt`.
 */
export async function latestEvidenceAssertsSettlement(
  predictionId: string,
): Promise<{ assertedAt: Date; probability: number | null } | null> {
  const [latest, pin] = await Promise.all([
    prisma.contextSnapshot.findFirst({
      where: { predictionId, insufficientData: false, ...NOT_CLOCK },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, externalProbability: true },
    }),
    prisma.contextSnapshot.findFirst({
      where: {
        predictionId,
        insufficientData: false,
        oracleSettled: true,
        ...NOT_CLOCK,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ])
  if (latest === null || pin === null || latest.id !== pin.id) return null
  return { assertedAt: latest.createdAt, probability: latest.externalProbability }
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
 * Mark a forecast as Oracul-attempted when the Oracul produced no usable sources
 * (no articles / no estimate). Writes an empty oracleSnapshot marker so the backfill
 * stops re-selecting it (it now HAS a non-null oracleSnapshot) and the loop converges.
 * Touches nothing on the prediction — no estimate, no CI, no detailsText.
 */
export async function markOraculAttempted(predictionId: string, reason: string): Promise<void> {
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
  /** The enriched Oracul source roster: EnrichedOracleSource[] under `{ sources }`. */
  oracleSnapshot: Prisma.InputJsonValue
  confidence: number | null
  aiCiLow: number | null
  aiCiHigh: number | null
  /** Oracul settlement detection: the outcome was reported as an accomplished fact. */
  settled?: boolean
  /** The pool aggregated but found no usable signal (off-topic) — records an abstention,
   *  leaving any published confidence/CI standing (daatan#1473). */
  insufficientData?: boolean
  /** Why the pool abstained (`all_articles_off_topic`, `no_usable_weight`, …). */
  insufficientReason?: string | null
  /** Pool rows behind the abstaining aggregate; diagnostics only. */
  poolSize?: number | null
  /** Pool-aggregate diagnostics (retro#458 Phase 2); see `RecordEstimateInput`. */
  evidenceMass?: number | null
  nEff?: number | null
  ageAdjustedMass?: number | null
  /** Provenance passthrough (daatan#1617); see `RecordEstimateInput.engine`/`.schemaVersion`. */
  engine?: string | null
  schemaVersion?: string | null
}

/**
 * Persist ONLY an Oracul snapshot (for the active-forecast backfill): creates a
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
    evidenceMass: input.evidenceMass,
    nEff: input.nEff,
    ageAdjustedMass: input.ageAdjustedMass,
    engine: input.engine,
    schemaVersion: input.schemaVersion,
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
