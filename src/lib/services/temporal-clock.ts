import { Prisma, ClaimDirection, ClaimArchetype } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  saveClockSnapshot,
  getLatestEvidenceEstimate,
} from '@/lib/services/context'
import { MATERIAL_CHANGE_PTS } from '@/lib/services/oracle-snapshot'
import { classifyAndStoreTemporal } from '@/lib/services/temporal-classifier'
import { isDeadlineDivergent, DEADLINE_AGREEMENT_TOLERANCE_MS } from '@/lib/utils/deadline-divergence'
import {
  notifyDeadlinePassedQuietly,
  notifyPendingPastDeadline,
  notifyProvisionalImpossibility,
  notifyDeadlineDivergence,
  notifyRequoteSummary,
} from '@/lib/services/telegram'

const log = createLogger('temporal-clock')

export const TEMPORAL_ENGINE_VERSION = 'glide-v1'

/** Never display a literal 0/100 — matches the shipped settlement pin's 97/3 convention. */
export const PIN_LOW = 3
export const PIN_HIGH = 97

// DEADLINE_AGREEMENT_TOLERANCE_MS re-exported below for existing importers
// (temporal-clock.math.test.ts) — the canonical definition now lives in
// deadline-divergence.ts so a client component can share it without pulling
// in this module's server-only deps (daatan#1234).
export { DEADLINE_AGREEMENT_TOLERANCE_MS }

/** Keeps the glide continuous as c -> 0: 0 and 1 are degenerate bases for a pure
 *  power-law interpolation (0^c stays 0 for all c>0, only jumping to 1 exactly
 *  at c=0), so an anchor of exactly 0%/100% is nudged a hair inside the range. */
const P_EPSILON = 0.001

const SELF_HEAL_BATCH_SIZE = 5

/** #1185 sweep: leave same-day human resolutions alone before alerting. */
const PENDING_DEADLINE_GRACE_MS = 12 * 3600_000

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export interface RequoteInput {
  /** Last evidence-anchored probability, 0-100. */
  pLast: number
  /** Timestamp of that anchor. */
  tLast: Date
  now: Date
  /** Parsed from claim TEXT — may diverge from resolveByDatetime. */
  claimDeadline: Date
  resolveByDatetime: Date
  tauLeadDays: number
  direction: 'ARRIVAL' | 'SURVIVAL'
}

export interface RequoteResult {
  /** 0-100, rounded, clamped to [PIN_LOW, PIN_HIGH]. */
  p: number
  /** The glide fraction actually used (0 = at/past horizon, 1 = at the anchor). */
  c: number
  cause: 'glide' | 'pin' | 'pin-provisional'
  /** horizon - tauLeadDays. */
  tEff: Date
  /** The deadline actually glided toward (the later date, on divergence). */
  horizon: Date
  /** claimDeadline and resolveByDatetime disagree beyond tolerance. */
  divergent: boolean
  /** now >= the LITERAL claimDeadline (independent of tauLeadDays/divergence). */
  deadlinePassed: boolean
}

/**
 * The v1 zero-parameter constant-hazard glide (retro docs/TEMPORAL_MODEL_PLAN.md
 * #3.3): P(t) = 1-(1-P_last)^c for arrival, P_last^c for survival, where c runs
 * from 1 at the anchor to 0 at the effective horizon. Reaches the pin boundary
 * by construction — no separate pin formula needed, the c=0 case IS the pin.
 *
 * Returns null when the clock has nothing to say: the effective horizon is at
 * or before the anchor (e.g. a very tight tau_lead already consumed by the time
 * the anchor was written). Callers still get deadlinePassed/divergent context
 * for alerting by computing them directly off the candidate's own fields.
 */
export function computeRequote(input: RequoteInput): RequoteResult | null {
  const { pLast, tLast, now, claimDeadline, resolveByDatetime, tauLeadDays, direction } = input

  const claimPassed = claimDeadline.getTime() <= now.getTime()
  const divergent = isDeadlineDivergent(claimDeadline, resolveByDatetime, now)

  const horizon = divergent
    ? new Date(Math.max(claimDeadline.getTime(), resolveByDatetime.getTime()))
    : claimDeadline

  const tEff = new Date(horizon.getTime() - tauLeadDays * 86_400_000)

  if (tEff.getTime() <= tLast.getTime()) return null

  // Domain guard: clamped to [0,1] so the exponent never goes negative past the
  // horizon (unclamped, P_last=0.8 one interval past tEff gives 1-0.2^-1 = -400%).
  const c = clamp(
    (tEff.getTime() - now.getTime()) / (tEff.getTime() - tLast.getTime()),
    0,
    1,
  )

  const pFrac = clamp(pLast / 100, P_EPSILON, 1 - P_EPSILON)
  const resultFrac = direction === 'ARRIVAL' ? 1 - Math.pow(1 - pFrac, c) : Math.pow(pFrac, c)
  const p = clamp(Math.round(resultFrac * 100), PIN_LOW, PIN_HIGH)

  const atOrPastHorizon = now.getTime() >= tEff.getTime()
  const cause: RequoteResult['cause'] = !atOrPastHorizon
    ? 'glide'
    : divergent
      ? 'glide' // reached the (safer, later) horizon, but disagreement is unresolved — never a hard pin
      : claimPassed
        ? 'pin'
        : 'pin-provisional' // tau_lead pushed tEff before the literal deadline

  return { p, c, cause, tEff, horizon, divergent, deadlinePassed: claimPassed }
}

/** Applies the same glide fraction to a CI bound so the band stays coherent
 *  with the point estimate (and collapses to the point value at the pin). */
export function glideValue(v: number, c: number, direction: 'ARRIVAL' | 'SURVIVAL'): number {
  const frac = clamp(v / 100, P_EPSILON, 1 - P_EPSILON)
  const result = direction === 'ARRIVAL' ? 1 - Math.pow(1 - frac, c) : Math.pow(frac, c)
  return Math.round(clamp(result * 100, 0, 100))
}

export interface RequoteSummary {
  examined: number
  glided: number
  pinned: number
  provisionalPins: number
  unchanged: number
  skippedNoAnchor: number
  skippedTeffBeforeAnchor: number
  selfHealed: number
  divergenceAlerts: number
  deadlineAlerts: number
  provisionalAlerts: number
  pendingDeadlineAlerts: number
  errors: number
  deltas: number[]
}

function emptySummary(): RequoteSummary {
  return {
    examined: 0,
    glided: 0,
    pinned: 0,
    provisionalPins: 0,
    unchanged: 0,
    skippedNoAnchor: 0,
    skippedTeffBeforeAnchor: 0,
    selfHealed: 0,
    divergenceAlerts: 0,
    deadlineAlerts: 0,
    provisionalAlerts: 0,
    pendingDeadlineAlerts: 0,
    errors: 0,
    deltas: [],
  }
}

interface RequoteCandidate {
  id: string
  slug: string | null
  claimText: string
  confidence: number | null
  aiCiLow: number | null
  aiCiHigh: number | null
  claimDeadline: Date | null
  claimDirection: ClaimDirection | null
  tauLeadDays: number | null
  resolveByDatetime: Date
  deadlinePassedAlertAt: Date | null
  teffProvisionalAlertAt: Date | null
  divergenceAlertAt: Date | null
}

/** claimArchetype is added per-call from the allowlist (see runRequote) — v1
 *  only ever prices DIFFUSE; scheduled/threshold/none never glide. */
const CANDIDATE_WHERE: Prisma.PredictionWhereInput = {
  status: 'ACTIVE',
  outcomeType: 'BINARY',
  settled: false, // settlement pin takes precedence — the clock never touches a settled forecast
  claimDirection: { in: [ClaimDirection.ARRIVAL, ClaimDirection.SURVIVAL] },
  claimDeadline: { not: null },
}

async function selfHeal(limit: number): Promise<number> {
  const unclassified = await prisma.prediction.findMany({
    where: { status: 'ACTIVE', classifierVersion: null },
    select: { id: true, claimText: true, resolveByDatetime: true, outcomeType: true },
    take: limit,
  })
  let healed = 0
  for (const p of unclassified) {
    try {
      await classifyAndStoreTemporal(p)
      healed++
    } catch (err) {
      log.warn({ predictionId: p.id, err }, 'requote self-heal classification failed')
    }
  }
  return healed
}

/** Fire when never alerted, or when the last alert predates the CURRENT
 *  deadline — reclassifying to a later date re-arms once that date passes
 *  too, instead of a plain NULL check permanently silencing the forecast. */
function dueForAlert(alertAt: Date | null, deadline: Date): boolean {
  return alertAt === null || alertAt.getTime() < deadline.getTime()
}

async function processCandidate(c: RequoteCandidate, now: Date, summary: RequoteSummary): Promise<void> {
  const anchor = await getLatestEvidenceEstimate(c.id)
  const deadlinePassed = c.claimDeadline !== null && c.claimDeadline.getTime() <= now.getTime()

  // Single-shot literal-deadline alert applies even without a usable anchor —
  // an unfired glide shouldn't also mean a silent, unresolvable deadline.
  if (deadlinePassed && dueForAlert(c.deadlinePassedAlertAt, c.claimDeadline!)) {
    notifyDeadlinePassedQuietly(
      { id: c.id, claimText: c.claimText, slug: c.slug },
      c.claimDirection === ClaimDirection.ARRIVAL ? 'arrival' : 'survival',
      c.claimDeadline!,
    )
    await prisma.prediction.update({ where: { id: c.id }, data: { deadlinePassedAlertAt: now } })
    summary.deadlineAlerts++
  }

  if (!anchor) {
    summary.skippedNoAnchor++
    return
  }

  // F17 (daatan#1236): anchor to when the evidence was published, not when this
  // row was written — falls back to createdAt for rows with no parseable
  // evidence date (all pre-migration rows, and any push whose sources carried
  // no usable publishedAt).
  const tLast = anchor.evidenceAt ?? anchor.createdAt
  const result = computeRequote({
    pLast: anchor.externalProbability,
    tLast,
    now,
    claimDeadline: c.claimDeadline!,
    resolveByDatetime: c.resolveByDatetime,
    tauLeadDays: c.tauLeadDays ?? 0,
    direction: c.claimDirection as 'ARRIVAL' | 'SURVIVAL',
  })

  if (!result) {
    summary.skippedTeffBeforeAnchor++
    return
  }

  if (result.divergent && dueForAlert(c.divergenceAlertAt, c.claimDeadline!)) {
    notifyDeadlineDivergence({ id: c.id, claimText: c.claimText, slug: c.slug }, c.claimDeadline!, c.resolveByDatetime)
    await prisma.prediction.update({ where: { id: c.id }, data: { divergenceAlertAt: now } })
    summary.divergenceAlerts++
  }

  if (result.cause === 'pin-provisional' && dueForAlert(c.teffProvisionalAlertAt, c.claimDeadline!)) {
    notifyProvisionalImpossibility({ id: c.id, claimText: c.claimText, slug: c.slug }, result.tEff, c.claimDeadline!, c.tauLeadDays ?? 0)
    await prisma.prediction.update({ where: { id: c.id }, data: { teffProvisionalAlertAt: now } })
    summary.provisionalAlerts++
  }

  // An abstained forecast has null confidence, so `?? result.p` below makes delta exactly
  // 0 and the material-change test swallows the write. That fallback is right for what it
  // was written for — don't churn a first-run row that has no prior — and exactly wrong
  // for a pin: the impossibility pin is priced from question metadata alone, needs no
  // articles, and outranks abstention in the publish-time precedence (system-model §6.2)
  // precisely because "we have no evidence" is not a reason to withhold "this can no
  // longer happen". Scoped to pins: a glide over a null-confidence row still has no prior
  // to be material against, and letting it through would churn every tick. (daatan#1265)
  const isPin = result.cause === 'pin' || result.cause === 'pin-provisional'
  const hasNoPrior = c.confidence === null
  const prevConfidence = c.confidence ?? result.p
  const delta = Math.abs(result.p - prevConfidence)
  if (delta < MATERIAL_CHANGE_PTS && !(isPin && hasNoPrior)) {
    summary.unchanged++
    return
  }

  const direction = c.claimDirection as 'ARRIVAL' | 'SURVIVAL'
  await saveClockSnapshot({
    predictionId: c.id,
    probability: result.p,
    aiCiLow: c.aiCiLow !== null ? glideValue(c.aiCiLow, result.c, direction) : null,
    aiCiHigh: c.aiCiHigh !== null ? glideValue(c.aiCiHigh, result.c, direction) : null,
    meta: {
      engineVersion: TEMPORAL_ENGINE_VERSION,
      cause: result.cause,
      pLast: anchor.externalProbability,
      tLast: tLast.toISOString(),
      tEff: result.tEff.toISOString(),
      c: result.c,
      direction: c.claimDirection,
    },
  })

  // Only a row with a prior has a delta. Pushing the 0 that `?? result.p` manufactures for
  // a null-confidence pin would drag deltaP50/deltaMax toward zero with a number that
  // describes nothing (daatan#1265).
  if (!hasNoPrior) summary.deltas.push(delta)
  if (result.cause === 'pin') summary.pinned++
  else if (result.cause === 'pin-provisional') summary.provisionalPins++
  else summary.glided++
}

/**
 * #1185: a PENDING pred outside the awaiting-AI probability band has no
 * automated resolution path and no human alert — the deadline alert above
 * only covers ACTIVE candidates, and the ACTIVE→PENDING transition happens
 * lazily from the forecasts list API, so a pred can leave ACTIVE before the
 * sweep ever alerted on it. Alert-only: surface it on the clean channel and
 * stamp deadlinePassedAlertAt; resolution semantics stay untouched.
 * Deliberately independent of the archetype allowlist — coupling a safety
 * alert to unrelated gating is exactly how #1185 happened.
 */
async function alertPendingPastDeadline(now: Date, summary: RequoteSummary): Promise<void> {
  const stuck = await prisma.prediction.findMany({
    where: {
      status: 'PENDING',
      resolvedAt: null,
      claimDeadline: { lt: new Date(now.getTime() - PENDING_DEADLINE_GRACE_MS) },
      deadlinePassedAlertAt: null,
    },
    select: { id: true, slug: true, claimText: true, claimDeadline: true },
  })

  for (const p of stuck) {
    try {
      notifyPendingPastDeadline({ id: p.id, claimText: p.claimText, slug: p.slug }, p.claimDeadline!)
      await prisma.prediction.update({ where: { id: p.id }, data: { deadlinePassedAlertAt: now } })
      summary.pendingDeadlineAlerts++
    } catch (err) {
      summary.errors++
      log.warn({ predictionId: p.id, err }, 'pending-deadline alert failed')
    }
  }
}

export interface RunRequoteOptions {
  /** Lowercase archetype names allowed to glide this run (e.g. ['diffuse']). Empty = no-op. */
  archetypes: string[]
  now?: Date
  /** Compute and report, write nothing, send no alerts. */
  dryRun?: boolean
}

/**
 * Daily production driver (retro docs/TEMPORAL_MODEL_PLAN.md #4 Stage 0): the
 * component that makes P(t) actually move on a quiet day. Pure arithmetic per
 * candidate — no Oracle call, no search, no LLM — except the bounded self-heal
 * pass that classifies any ACTIVE forecast still missing metadata.
 */
export async function runRequote(opts: RunRequoteOptions): Promise<RequoteSummary> {
  const now = opts.now ?? new Date()
  const summary = emptySummary()

  if (opts.archetypes.length === 0) {
    if (!opts.dryRun) await alertPendingPastDeadline(now, summary)
    return summary
  }

  if (!opts.dryRun) {
    summary.selfHealed = await selfHeal(SELF_HEAL_BATCH_SIZE)
  }

  const allowed = opts.archetypes.map((a) => a.toUpperCase())
  const where: Prisma.PredictionWhereInput = {
    ...CANDIDATE_WHERE,
    claimArchetype: { in: allowed.filter((a) => a === 'DIFFUSE') as ClaimArchetype[] },
  }

  const candidates = await prisma.prediction.findMany({
    where,
    select: {
      id: true,
      slug: true,
      claimText: true,
      confidence: true,
      aiCiLow: true,
      aiCiHigh: true,
      claimDeadline: true,
      claimDirection: true,
      tauLeadDays: true,
      resolveByDatetime: true,
      deadlinePassedAlertAt: true,
      teffProvisionalAlertAt: true,
      divergenceAlertAt: true,
    },
  })

  summary.examined = candidates.length

  for (const c of candidates) {
    try {
      if (opts.dryRun) {
        // Preview only: run the math, skip every write/alert side effect.
        const anchor = await getLatestEvidenceEstimate(c.id)
        if (!anchor) {
          summary.skippedNoAnchor++
          continue
        }
        const result = computeRequote({
          pLast: anchor.externalProbability,
          tLast: anchor.evidenceAt ?? anchor.createdAt,
          now,
          claimDeadline: c.claimDeadline!,
          resolveByDatetime: c.resolveByDatetime,
          tauLeadDays: c.tauLeadDays ?? 0,
          direction: c.claimDirection as 'ARRIVAL' | 'SURVIVAL',
        })
        if (!result) {
          summary.skippedTeffBeforeAnchor++
          continue
        }
        summary.deltas.push(Math.abs(result.p - (c.confidence ?? result.p)))
        if (result.cause === 'pin') summary.pinned++
        else if (result.cause === 'pin-provisional') summary.provisionalPins++
        else summary.glided++
      } else {
        await processCandidate(c, now, summary)
      }
    } catch (err) {
      summary.errors++
      log.warn({ predictionId: c.id, err }, 'requote candidate failed')
    }
  }

  if (!opts.dryRun) {
    await alertPendingPastDeadline(now, summary)
  }

  const moved = summary.glided + summary.pinned + summary.provisionalPins
  log.info(
    {
      examined: summary.examined,
      glided: summary.glided,
      pinned: summary.pinned,
      provisionalPins: summary.provisionalPins,
      unchanged: summary.unchanged,
      selfHealed: summary.selfHealed,
      pendingDeadlineAlerts: summary.pendingDeadlineAlerts,
      errors: summary.errors,
      deltaP50: median(summary.deltas),
      deltaMax: summary.deltas.length ? Math.max(...summary.deltas) : 0,
    },
    'requote.done',
  )

  if (!opts.dryRun && moved > 0) {
    notifyRequoteSummary({
      glided: summary.glided,
      pinned: summary.pinned,
      maxDeltaPts: summary.deltas.length ? Math.max(...summary.deltas) : 0,
      divergences: summary.divergenceAlerts,
    })
  }

  return summary
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
