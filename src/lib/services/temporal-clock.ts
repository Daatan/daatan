import { Prisma, ClaimDirection, ClaimArchetype } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  saveClockSnapshot,
  getLatestEvidenceEstimate,
  getSettlementPinProbability,
  latestEvidenceAssertsSettlement,
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
  notifySettledDrift,
  notifyUnlatchedPin,
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

/** How far a latched forecast's published probability may sit from the value its
 *  settlement pin published before the pair stops telling one story (daatan#1490).
 *  Below 10pt the number and the badge still agree in substance — a pin at 97 next
 *  to 92 reads as the same claim. At 10pt and beyond the page asserts an accomplished
 *  fact beside a number that visibly no longer does, and one of the two is wrong.
 *  Measured against the population that motivated the issue: the drifts were 5, 12,
 *  15, 22, 28, 32 and (post-A6) 42, so this catches every case except the 5. */
const SETTLED_DRIFT_PTS = 10

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

/**
 * The band for a requote, glided from the ANCHOR's CI with the same absolute
 * progress factor `c` the point estimate uses.
 *
 * It must not be glided from Prediction.aiCiLow/aiCiHigh: `c` measures progress
 * from the anchor, not from the previous tick, so re-applying it to a value the
 * previous tick already glided compounds it. The point never had this bug (it is
 * always re-derived from `anchor.externalProbability`), so band and point drifted
 * apart until the point sat outside its own interval — 5 ACTIVE forecasts, one
 * showing 18% with a [0, 0] band whose anchor was [12, 93] (daatan#1489).
 *
 * `glideValue` is strictly increasing in v (f'(x) = c(1-x)^(c-1) > 0), so anchoring
 * both bounds and the point on one `c` preserves low <= p <= high *by construction*.
 * The final clamp is only needed because the point clamps to [PIN_LOW, PIN_HIGH]
 * while the bounds clamp to [0, 100]: at full decay an ARRIVAL point floors at
 * PIN_LOW while its bounds keep going to 0.
 */
export function glideBand(
  anchor: { ciLow: number | null; ciHigh: number | null },
  c: number,
  direction: 'ARRIVAL' | 'SURVIVAL',
  p: number,
): { aiCiLow: number | null; aiCiHigh: number | null } {
  const low = anchor.ciLow !== null ? glideValue(anchor.ciLow, c, direction) : null
  const high = anchor.ciHigh !== null ? glideValue(anchor.ciHigh, c, direction) : null
  return {
    aiCiLow: low === null ? null : Math.min(low, p),
    aiCiHigh: high === null ? null : Math.max(high, p),
  }
}

export interface RequoteSummary {
  examined: number
  glided: number
  pinned: number
  provisionalPins: number
  unchanged: number
  skippedNoAnchor: number
  skippedTeffBeforeAnchor: number
  /** Candidates whose anchor asserts settlement while `Prediction.settled` is false
   *  — the latch gap of daatan#1498. Not a normal skip: it is an invariant violation
   *  the clock declines to act on, and the only place anything looks for it. */
  skippedUnlatchedPin: number
  selfHealed: number
  divergenceAlerts: number
  deadlineAlerts: number
  provisionalAlerts: number
  pendingDeadlineAlerts: number
  /** Latched forecasts whose published number has drifted off their settlement
   *  pin far enough to be re-verified rather than believed (daatan#1490). */
  settledDriftAlerts: number
  /** The mirror: forecasts whose latest evidence asserts settlement while the latch
   *  is false (daatan#1498). Nothing else looks for this state — #1490's sweep
   *  selects on the latch, so it structurally cannot see them. */
  unlatchedPinAlerts: number
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
    skippedUnlatchedPin: 0,
    selfHealed: 0,
    divergenceAlerts: 0,
    deadlineAlerts: 0,
    provisionalAlerts: 0,
    pendingDeadlineAlerts: 0,
    settledDriftAlerts: 0,
    unlatchedPinAlerts: 0,
    errors: 0,
    deltas: [],
  }
}

interface RequoteCandidate {
  id: string
  slug: string | null
  claimText: string
  confidence: number | null
  /** Stored band. Read ONLY to detect the pre-fix corrupted state — never glided
   *  from; the band is anchored via glideBand (daatan#1489). */
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

/**
 * The clock never touches a settled forecast — `CANDIDATE_WHERE` enforces that with
 * `settled: false`, which is correct only as long as a settlement-asserting write
 * actually latches `Prediction.settled`. It does not always: 19 ACTIVE forecasts carry
 * 771 snapshots asserting `settled` with the latch unset (daatan#1498, cause still
 * unexplained). Those forecasts fall through into the candidate set, and the glide then
 * anchors on the settlement pin and decays it — turning a transient pin into the origin
 * of a decay curve, which is strictly worse than leaving it alone.
 *
 * So enforce the same rule one layer in, on the anchor rather than the row. Declining to
 * glide leaves the published number where it is; correcting it is a pool question, not a
 * clock one. The deadline alert above still fires, so a skipped forecast past its
 * deadline is not silent — only its glide is withheld.
 */
function anchorIsUnlatchedPin(anchor: { settled: boolean }): boolean {
  return anchor.settled
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

  if (anchorIsUnlatchedPin(anchor)) {
    log.warn(
      { predictionId: c.id, slug: c.slug, anchorProbability: anchor.externalProbability },
      'requote skipped: anchor asserts settlement but Prediction.settled is false (daatan#1498)',
    )
    summary.skippedUnlatchedPin++
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
  // daatan#1489 self-heal: a row whose stored point sits outside its stored band is
  // carrying a band compounded by the pre-fix glide. Its point is typically stable, so
  // the material-change gate would skip it forever and the nonsense band would never be
  // rewritten. Let exactly one write through to re-anchor it; glideBand then restores
  // low <= p <= high, so this stops firing on the next tick.
  const bandCorrupt =
    c.confidence !== null &&
    c.aiCiLow !== null &&
    c.aiCiHigh !== null &&
    (c.confidence < c.aiCiLow || c.confidence > c.aiCiHigh)
  if (delta < MATERIAL_CHANGE_PTS && !(isPin && hasNoPrior) && !bandCorrupt) {
    summary.unchanged++
    return
  }

  const direction = c.claimDirection as 'ARRIVAL' | 'SURVIVAL'
  await saveClockSnapshot({
    predictionId: c.id,
    probability: result.p,
    ...glideBand(anchor, result.c, direction, result.p),
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

/**
 * daatan#1490. `settled` is the strongest claim the system makes about a forecast,
 * and it is sticky: the writers only ever set it true, and the single admin
 * one-click is the only way back. The probability underneath it is not sticky — it
 * keeps being re-derived from evidence — so the two drift apart, and all seven
 * latched ACTIVE forecasts were pinned at 97 while showing 55–97.
 *
 * Of the three options on the issue this implements (2): drift forces
 * re-verification. Not (1), auto-clear — that removes the badge and leaves a
 * forecast that was once settled looking identical to one that never was, deciding
 * nothing. Not (3), let the pin hold the probability — the A6 remediation moved two
 * of these *further* from their pins onto numbers that reproduce their own pools to
 * within 0.4pp, so on this population the pin is the stale artefact and freezing the
 * number to it would publish what the evidence contradicts.
 *
 * Re-verification here means the queue a human actually works from: the forecast
 * goes back into Awaiting Resolution (`/api/forecasts?awaitingAiResolution`) and
 * pages once. That flag is otherwise recomputed on every estimate write from the
 * current number alone, so a latched forecast silently drops OUT of the queue as it
 * drifts — which is exactly how these seven became invisible.
 */
async function reverifyDriftedSettled(now: Date, summary: RequoteSummary): Promise<void> {
  // Guarded against the column not being there yet. blue-green-deploy.sh Phase 5 runs
  // `prisma migrate deploy` before the swap and aborts on failure, so ordinarily the
  // column lands ahead of this code — but the cron also runs against environments that
  // were not deployed that way (a restored DB, a hand-rolled container), and there an
  // unguarded throw would take the whole requote down with it. Degrades to one counted
  // error per run, which shows up in the summary rather than passing for a clean run.
  let latched: { id: string; slug: string | null; claimText: string; confidence: number | null; settledDriftAlertAt: Date | null; awaitingDismissedAt: Date | null }[]
  try {
    latched = await prisma.prediction.findMany({
      where: { status: 'ACTIVE', settled: true, confidence: { not: null } },
      select: { id: true, slug: true, claimText: true, confidence: true, settledDriftAlertAt: true, awaitingDismissedAt: true },
    })
  } catch (err) {
    summary.errors++
    log.warn({ err }, 'settled-drift sweep query failed — is the #1490 migration applied?')
    return
  }

  for (const p of latched) {
    try {
      const pin = await getSettlementPinProbability(p.id)
      // No snapshot carries the pin (pre-#1053 latch, or a backfilled one). Nothing
      // to compare against, and inventing a baseline from the current number would
      // define the drift away.
      if (pin === null) continue

      const drift = Math.abs(pin - (p.confidence as number))
      if (drift < SETTLED_DRIFT_PTS) {
        // Re-arm: the gap closed, so a later re-crossing pages again.
        if (p.settledDriftAlertAt !== null) {
          await prisma.prediction.update({ where: { id: p.id }, data: { settledDriftAlertAt: null } })
        }
        continue
      }
      if (p.settledDriftAlertAt !== null) continue // already firing, already queued
      // A human dismissed this one (daatan#1659); recordEstimate forgets the
      // dismissal once the number moves, and the sweep re-checks daily.
      if (p.awaitingDismissedAt) continue

      await prisma.prediction.update({
        where: { id: p.id },
        data: { awaitingAiResolution: true, settledDriftAlertAt: now },
      })
      notifySettledDrift({ id: p.id, claimText: p.claimText, slug: p.slug }, pin, p.confidence as number)
      summary.settledDriftAlerts++
    } catch (err) {
      summary.errors++
      log.warn({ predictionId: p.id, err }, 'settled-drift re-verification failed')
    }
  }
}

/**
 * The mirror sweep (daatan#1498): the evidence asserts settlement, the latch is false.
 *
 * `reverifyDriftedSettled` above asks "is a latched forecast still worth believing".
 * This asks the opposite and structurally harder question — nothing else can, because
 * every other consumer of settlement selects on `Prediction.settled`, which is exactly
 * the field that is wrong here. So the state is invisible by construction: no settled
 * badge, still a glide candidate, absent from the drift sweep, and the published number
 * sits inside its own band so the #1489 check passes it too. One forecast spent 3.6 days
 * publishing 97 against a pool of 62 in precisely this state, and it took a manual
 * population-wide recompute to find it.
 *
 * It does NOT set the latch. Auto-latching is the obvious move and it is wrong twice
 * over: re-aggregating the pool of the forecast that motivated the issue returned
 * `settled: false`, so the assertion is usually the transient and latching would pin a
 * false positive behind a manual-only release; and where the latch was cleared on
 * purpose, re-latching would silently overrule the operator. Fresh evidence decides —
 * this only makes sure a human is looking, via the same Awaiting Resolution queue #1490
 * uses.
 */
async function alertUnlatchedPins(now: Date, summary: RequoteSummary): Promise<void> {
  // Narrowed by relation first (~24 rows population-wide) so the per-candidate currency
  // check runs over a handful, not over every ACTIVE forecast. Guarded for the same
  // reason as the sweep above.
  let candidates: { id: string; slug: string | null; claimText: string; unlatchedPinAlertAt: Date | null; awaitingDismissedAt: Date | null }[]
  try {
    candidates = await prisma.prediction.findMany({
      where: {
        status: 'ACTIVE',
        settled: false,
        contextSnapshots: {
          some: {
            kind: { not: 'clock' },
            insufficientData: false,
            oracleSettled: true,
          },
        },
      },
      select: { id: true, slug: true, claimText: true, unlatchedPinAlertAt: true, awaitingDismissedAt: true },
    })
  } catch (err) {
    summary.errors++
    log.warn({ err }, 'unlatched-pin sweep query failed — is the #1498 migration applied?')
    return
  }

  for (const p of candidates) {
    try {
      // Having asserted settlement at some point is not the anomaly — most of these
      // have published unsettled numbers since and simply moved on. The anomaly is the
      // assertion being the forecast's current position.
      const asserted = await latestEvidenceAssertsSettlement(p.id)
      if (asserted === null) {
        // Re-arm: the evidence stopped asserting it, so a recurrence pages again.
        if (p.unlatchedPinAlertAt !== null) {
          await prisma.prediction.update({ where: { id: p.id }, data: { unlatchedPinAlertAt: null } })
        }
        continue
      }
      if (p.unlatchedPinAlertAt !== null) continue // already firing, already queued
      if (p.awaitingDismissedAt) continue // human dismissed (daatan#1659)

      await prisma.prediction.update({
        where: { id: p.id },
        data: { awaitingAiResolution: true, unlatchedPinAlertAt: now },
      })
      notifyUnlatchedPin({ id: p.id, claimText: p.claimText, slug: p.slug }, asserted.probability, asserted.assertedAt)
      summary.unlatchedPinAlerts++
    } catch (err) {
      summary.errors++
      log.warn({ predictionId: p.id, err }, 'unlatched-pin alert failed')
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
 * candidate — no Oracul call, no search, no LLM — except the bounded self-heal
 * pass that classifies any ACTIVE forecast still missing metadata.
 */
export async function runRequote(opts: RunRequoteOptions): Promise<RequoteSummary> {
  const now = opts.now ?? new Date()
  const summary = emptySummary()

  if (opts.archetypes.length === 0) {
    // Both sweeps are population-wide and have nothing to do with archetypes, so an
    // empty allowlist disables the glide and nothing else.
    if (!opts.dryRun) {
      await alertPendingPastDeadline(now, summary)
      await reverifyDriftedSettled(now, summary)
      await alertUnlatchedPins(now, summary)
    }
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
        if (anchorIsUnlatchedPin(anchor)) {
          summary.skippedUnlatchedPin++
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
    await reverifyDriftedSettled(now, summary)
    await alertUnlatchedPins(now, summary)
  }

  const moved = summary.glided + summary.pinned + summary.provisionalPins
  log.info(
    {
      examined: summary.examined,
      glided: summary.glided,
      pinned: summary.pinned,
      provisionalPins: summary.provisionalPins,
      unchanged: summary.unchanged,
      skippedUnlatchedPin: summary.skippedUnlatchedPin,
      selfHealed: summary.selfHealed,
      pendingDeadlineAlerts: summary.pendingDeadlineAlerts,
      settledDriftAlerts: summary.settledDriftAlerts,
      unlatchedPinAlerts: summary.unlatchedPinAlerts,
      errors: summary.errors,
      deltaP50: median(summary.deltas),
      deltaMax: summary.deltas.length ? Math.max(...summary.deltas) : 0,
    },
    'requote.done',
  )

  // `unlatchedPins` also arms the summary: a run that only skipped invariant
  // violations moved nothing, and staying silent about it is how daatan#1498 went
  // unnoticed from July to a manual sweep in August.
  if (!opts.dryRun && (moved > 0 || summary.skippedUnlatchedPin > 0)) {
    notifyRequoteSummary({
      glided: summary.glided,
      pinned: summary.pinned,
      maxDeltaPts: summary.deltas.length ? Math.max(...summary.deltas) : 0,
      divergences: summary.divergenceAlerts,
      unlatchedPins: summary.skippedUnlatchedPin,
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
