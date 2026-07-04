import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { notifyHighConfidence } from '@/lib/services/telegram'

const log = createLogger('context-service')

/** AI-estimate level (0–100) at or above which a crossing fires a Telegram alert. */
const HIGH_CONFIDENCE_THRESHOLD = 80

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

/** Fetch prediction with context snapshots for the GET timeline endpoint. */
export async function getContextTimeline(idOrSlug: string) {
  return prisma.prediction.findFirst({
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

/** Persist a context snapshot and update the prediction in a single transaction. */
export async function saveContextUpdate(input: SaveContextUpdateInput) {
  const prev = await readPreviousConfidence(input.predictionId)
  const [snapshot] = await prisma.$transaction([
    prisma.contextSnapshot.create({
      data: {
        predictionId: input.predictionId,
        summary: input.summary,
        sources: input.sources,
        externalProbability: input.externalProbability,
        externalReasoning: input.externalReasoning,
        oracleSnapshot: input.oracleSnapshot ?? undefined,
        insufficientData: input.insufficientData ?? false,
      },
    }),
    prisma.prediction.update({
      where: { id: input.predictionId },
      data: {
        detailsText: input.summary,
        contextUpdatedAt: input.now,
        // On abstention, explicitly null the AI estimate (the latest run says the
        // evidence is insufficient). Otherwise preserve a prior confidence when
        // this run produced none (e.g. a timeout) by only writing it when present.
        ...(input.insufficientData
          ? { confidence: null, aiCiLow: null, aiCiHigh: null }
          : {
              ...(input.confidence !== null && { confidence: input.confidence }),
              aiCiLow: input.aiCiLow,
              aiCiHigh: input.aiCiHigh,
            }),
        // Sticky: a later thin/abstained run must not clear a detected settlement.
        ...(input.settled && { settled: true, settledAt: input.now }),
      },
    }),
    // Invalidate stale detailsText translations: this update overwrites the
    // English summary, so any cached he/ru/eo translation is now out of date.
    // Dropping the rows makes SSR fall back to the source until the next
    // on-demand re-translation (which the content-aware cache also enforces).
    prisma.predictionTranslation.deleteMany({
      where: { predictionId: input.predictionId, fieldName: 'detailsText' },
    }),
  ])
  if (!input.insufficientData) {
    notifyIfCrossedHighConfidence(input.predictionId, prev, input.confidence, input.settled)
  }
  return snapshot
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

/** Identity of an evidence set for dedup purposes: its sorted source-URL list. */
function sourceUrlKey(sources: unknown): string {
  if (!Array.isArray(sources)) return ''
  return sources
    .map(s => String((s as { url?: unknown })?.url ?? ''))
    .sort()
    .join('|')
}

/** The Oracle mean out of a stored/incoming oracleSnapshot payload, else null. */
function oracleMean(snapshot: unknown): number | null {
  const mean = (snapshot as { mean?: unknown })?.mean
  return typeof mean === 'number' ? mean : null
}

/**
 * Persist a news-indexer article match: creates a ContextSnapshot (no LLM summary)
 * and updates the prediction's probability fields.
 * Does NOT touch detailsText or contextUpdatedAt — preserves user-triggered context
 * and does not consume the 1-hour user cooldown.
 *
 * Dedup: the news-indexer matcher re-pushes the same article set on every poll
 * cycle while its cooldown window rolls, which used to stack identical timeline
 * entries minutes apart. If the latest snapshot is a news-indexer match with the
 * same probability, the same Oracle mean, and the same source-URL set, this push
 * is the same measurement re-delivered — skip the write entirely.
 */
export async function saveNewsIndexerMatch(input: SaveNewsIndexerMatchInput): Promise<void> {
  // Skip clock rows when finding "the latest push": a daily requote sitting
  // between two identical article pushes must not defeat this dedup check
  // (the reasoning-marker comparison would never match a clock row anyway,
  // silently re-admitting the exact duplicate #1006 fixed).
  const latest = await prisma.contextSnapshot.findFirst({
    where: { predictionId: input.predictionId, ...NOT_CLOCK },
    orderBy: { createdAt: 'desc' },
    select: { externalReasoning: true, externalProbability: true, sources: true, oracleSnapshot: true },
  })
  if (
    latest &&
    latest.externalReasoning === NEWS_INDEXER_REASONING &&
    latest.externalProbability === input.externalProbability &&
    oracleMean(latest.oracleSnapshot) === oracleMean(input.oracleSnapshot) &&
    sourceUrlKey(latest.sources) === sourceUrlKey(input.sources)
  ) {
    log.info({ predictionId: input.predictionId }, 'Skipped duplicate news-indexer snapshot')
    return
  }

  const prev = await readPreviousConfidence(input.predictionId)
  await prisma.$transaction([
    prisma.contextSnapshot.create({
      data: {
        predictionId: input.predictionId,
        summary: '',
        sources: input.sources,
        externalProbability: input.externalProbability,
        externalReasoning: NEWS_INDEXER_REASONING,
        oracleSnapshot: input.oracleSnapshot,
      },
    }),
    prisma.prediction.update({
      where: { id: input.predictionId },
      data: {
        confidence: input.externalProbability,
        aiCiLow: input.ciLow,
        aiCiHigh: input.ciHigh,
        ...(input.settled && { settled: true, settledAt: new Date() }),
      },
    }),
  ])
  notifyIfCrossedHighConfidence(input.predictionId, prev, input.externalProbability, input.settled)
}

/** Fetch the full context snapshot timeline for a prediction. */
export async function listContextSnapshots(predictionId: string) {
  return prisma.contextSnapshot.findMany({
    where: { predictionId, ...NOT_CLOCK },
    orderBy: { createdAt: 'desc' },
  })
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
 * Mark a forecast as Oracle-attempted when the Oracle produced no usable sources
 * (no articles / no estimate). Writes an empty oracleSnapshot marker so the backfill
 * stops re-selecting it (it now HAS a non-null oracleSnapshot) and the loop converges.
 * Touches nothing on the prediction — no estimate, no CI, no detailsText.
 */
export async function markOracleAttempted(predictionId: string, reason: string): Promise<void> {
  await prisma.contextSnapshot.create({
    data: {
      predictionId,
      summary: '',
      sources: [],
      externalReasoning: `TruthMachine Oracle (backfill: ${reason})`,
      oracleSnapshot: { sources: [], empty: true, reason },
    },
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
  const prev = await readPreviousConfidence(input.predictionId)
  await prisma.$transaction([
    prisma.contextSnapshot.create({
      data: {
        predictionId: input.predictionId,
        summary: '',
        sources: [],
        externalReasoning: 'TruthMachine Oracle (active-forecast backfill)',
        oracleSnapshot: input.oracleSnapshot,
      },
    }),
    prisma.prediction.update({
      where: { id: input.predictionId },
      data: {
        ...(input.confidence !== null && { confidence: input.confidence }),
        aiCiLow: input.aiCiLow,
        aiCiHigh: input.aiCiHigh,
        ...(input.settled && { settled: true, settledAt: new Date() }),
      },
    }),
  ])
  notifyIfCrossedHighConfidence(input.predictionId, prev, input.confidence, input.settled)
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
  await prisma.$transaction([
    prisma.contextSnapshot.create({
      data: {
        predictionId: input.predictionId,
        kind: 'clock',
        summary: '',
        sources: [],
        externalProbability: input.probability,
        meta: input.meta,
      },
    }),
    prisma.prediction.update({
      where: { id: input.predictionId },
      data: {
        confidence: input.probability,
        aiCiLow: input.aiCiLow,
        aiCiHigh: input.aiCiHigh,
      },
    }),
  ])
}
