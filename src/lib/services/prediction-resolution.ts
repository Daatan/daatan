import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { applyGlicko2Update } from '@/lib/services/expertise'
import { calculateEloUpdates } from '@/lib/services/elo'
import { computeMemberScores, computeMarketScore, MARKET_MEMBER, SENTINEL_MODE } from '@/lib/services/ai-panel-score'
import { updateTagRatingsInTx } from '@/lib/services/tag-ratings'
import { notifySearchEngines } from '@/lib/services/indexnow'
import { recordCalibration } from '@/lib/services/calibration'
import { detectPinContradiction } from '@/lib/utils/pin-contradiction'

const log = createLogger('prediction-resolution')

/** Numerical floor/ceiling for KL-divergence inputs — avoids log(0) / divide-by-zero
 *  at the 0/1 boundaries without materially changing the score anywhere else. */
const KL_EPSILON = 1e-6

/**
 * D_KL(user || market): rewards a user whose stated probability was confidently
 * right where the market wasn't (Phase 2, docs/EXPERTISE_RATING_SYSTEM.md,
 * daatan#1138). p = the user's probability (same scale/derivation as brierScore's
 * `p`), q = `Commitment.polymarketPrice` snapshotted at commit time. Both clipped
 * away from 0/1 so a certain call never produces ±Infinity. Exported for unit
 * testing; not itself wired into any ranking formula or the Glicko-2 update.
 */
export function binaryKLDivergence(p: number, q: number): number {
  const pc = Math.min(Math.max(p, KL_EPSILON), 1 - KL_EPSILON)
  const qc = Math.min(Math.max(q, KL_EPSILON), 1 - KL_EPSILON)
  return pc * Math.log(pc / qc) + (1 - pc) * Math.log((1 - pc) / (1 - qc))
}

export type ResolutionOutcome = 'correct' | 'wrong' | 'void' | 'unresolvable'

interface ResolutionOptions {
  outcome: ResolutionOutcome
  resolvedById: string
  evidenceLinks?: string[]
  resolutionNote?: string
  correctOptionId?: string
  resolutionOverrodePin?: boolean
}

/**
 * Resolve a prediction: update its status and compute Brier-based ΔRS for each commitment.
 *
 * Brier ΔRS: brierScore = (p − outcome)², rsChange = round((0.25 − BS) × 100)
 * BINARY:          p = (confidence + 100) / 200
 * MULTIPLE_CHOICE: p = confidence / 100
 *
 * Also computes peerScore, aiScore, and ELO deltas per commitment.
 * Void/unresolvable outcomes produce no RS/score changes.
 *
 * Returns the updated prediction record.
 * Throws if the prediction is not found, not in a resolvable state, or if
 * correctOptionId is missing/invalid for MULTIPLE_CHOICE predictions.
 */
export async function resolvePrediction(predictionId: string, options: ResolutionOptions) {
  const { outcome, resolvedById, evidenceLinks, resolutionNote, correctOptionId, resolutionOverrodePin } = options

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: {
      tags: { select: { id: true } },
      options: true,
      // Linked market + polarity, for the matched-time market benchmark (docs/LASSO.md §7).
      // Loaded once; each commitment reconstructs the market price as of its own instant.
      externalMarket: { select: { snapshots: { select: { createdAt: true, probability: true } } } },
      commitments: {
        include: {
          user: {
            select: {
              id: true,
              rs: true,
              mu: true,
              sigma: true,
              volatility: true,
              totalPredictions: true,
              correctPredictions: true,
              eloRating: true,
            },
          },
          // The AI-panel run current when this user staked, for matched-time Brier
          // (docs/LASSO.md §7). Null on commitments placed before the first run.
          aiRunAtCommit: {
            select: {
              estimates: { select: { model: true, mode: true, probability: true, promptVersion: true } },
            },
          },
        },
      },
    },
  })

  if (!prediction) {
    throw Object.assign(new Error('Prediction not found'), { statusCode: 404 })
  }

  if (prediction.status !== 'ACTIVE' && prediction.status !== 'PENDING') {
    throw Object.assign(new Error('Prediction cannot be resolved'), { statusCode: 400 })
  }

  const isMultipleChoice = prediction.outcomeType === 'MULTIPLE_CHOICE'
  if (isMultipleChoice && (outcome === 'correct' || outcome === 'wrong')) {
    if (!correctOptionId) {
      throw Object.assign(new Error('correctOptionId is required for multiple choice predictions'), { statusCode: 400 })
    }
    if (!prediction.options.some((o) => o.id === correctOptionId)) {
      throw Object.assign(new Error('correctOptionId does not match any option for this prediction'), { statusCode: 400 })
    }
  }

  // daatan#1234 check #2: a settlement pin / extreme AI confidence contradicting
  // this outcome requires explicit resolver acknowledgment. Recomputed here
  // (not trusted from the client) so a direct API call can't silently bypass
  // it and poison the future calibration-record marking (check #3).
  const pinContradiction = detectPinContradiction(prediction.settled, prediction.confidence, prediction.outcomeType, outcome)
  if (pinContradiction.contradicts && !resolutionOverrodePin) {
    throw Object.assign(
      new Error('This outcome contradicts the Oracle\'s current estimate — acknowledge the disagreement to proceed'),
      { statusCode: 400 },
    )
  }

  let newStatus: 'RESOLVED_CORRECT' | 'RESOLVED_WRONG' | 'VOID' | 'UNRESOLVABLE'
  if (outcome === 'correct') newStatus = 'RESOLVED_CORRECT'
  else if (outcome === 'wrong') newStatus = 'RESOLVED_WRONG'
  else if (outcome === 'void') newStatus = 'VOID'
  else newStatus = 'UNRESOLVABLE'

  const isVoidOutcome = outcome === 'void' || outcome === 'unresolvable'

  const { prediction: resolvedPrediction, scoringMs, updatingMs } = await prisma.$transaction(async (tx) => {
    const tScoringStart = Date.now()
    const updatedPrediction = await tx.prediction.update({
      where: { id: predictionId },
      data: {
        status: newStatus,
        resolvedAt: new Date(),
        resolvedById,
        resolutionOutcome: outcome,
        evidenceLinks: evidenceLinks ?? undefined,
        resolutionNote,
        resolutionOverrodePin: pinContradiction.contradicts ? true : null,
        // A resolved prediction is terminal — nothing should still read it as
        // awaiting AI resolution (daatan#1492 finding #2: 6 RESOLVED rows kept
        // the flag set because this update never cleared it).
        awaitingAiResolution: false,
      },
    })

    if (isMultipleChoice && correctOptionId && (outcome === 'correct' || outcome === 'wrong')) {
      for (const option of prediction.options) {
        await tx.predictionOption.update({
          where: { id: option.id },
          data: { isCorrect: option.id === correctOptionId },
        })
      }
    }

    // Per-commitment: Brier, RS, peer score, AI score
    const eloInputs: { userId: string; brierScore: number; eloRating: number }[] = []

    for (const commitment of prediction.commitments) {
      let rsChange = 0
      let brierScore: number | null = null
      let peerScore: number | null = null
      let aiScore: number | null = null
      let klDivergence: number | null = null

      if (!isVoidOutcome) {
        const confidence = commitment.cuCommitted
        let p: number
        let outcomeNumeric: number

        if (isMultipleChoice) {
          p = confidence / 100
          outcomeNumeric = commitment.optionId === correctOptionId ? 1 : 0
        } else {
          p = (confidence + 100) / 200
          outcomeNumeric = outcome === 'correct' ? 1 : 0
        }

        brierScore = Math.pow(p - outcomeNumeric, 2)
        rsChange = Math.round((0.25 - brierScore) * 100)

        if (commitment.communityProbabilityAtCommit != null) {
          peerScore =
            Math.pow(commitment.communityProbabilityAtCommit - outcomeNumeric, 2) - brierScore
        }
        if (commitment.aiProbabilityAtCommit != null) {
          aiScore =
            Math.pow(commitment.aiProbabilityAtCommit - outcomeNumeric, 2) - brierScore
        }

        // Phase 2 of the expertise-rating plan (daatan#1138): only when the market
        // price was actually snapshotted at commit time — most existing commitments
        // predate this field or have no linked market, and stay null.
        if (commitment.polymarketPrice != null) {
          klDivergence = binaryKLDivergence(p, commitment.polymarketPrice)
        }

        eloInputs.push({
          userId: commitment.userId,
          brierScore,
          eloRating: commitment.user.eloRating,
        })

        // Matched-time Brier for each panel member (and the Oracle) on this commitment.
        // Isolation: written to ai_member_scores only; never touches this user's score.
        //
        // BINARY only, sentinels included. Panel members estimate P(claim) and only ever
        // run on BINARY forecasts; on MULTIPLE_CHOICE the per-commitment outcome is
        // "did this user's option win" — a different question. Scoring the oracle/market
        // sentinels against it would blend two question types into one leaderboard row.
        if (prediction.outcomeType === 'BINARY') {
          const memberScores = computeMemberScores(
            commitment.aiRunAtCommit?.estimates ?? [],
            commitment.aiProbabilityAtCommit,
            outcomeNumeric,
          )
          // The linked market (Polymarket/Kalshi) scored on the same matched-time basis,
          // so the leaderboard can answer "does a model beat or approach the market?".
          // Null (skipped) when the forecast has no market or no price predates the commit.
          const marketBrier = computeMarketScore(
            prediction.externalMarket?.snapshots ?? [],
            prediction.externalMarketInverted,
            commitment.createdAt,
            outcomeNumeric,
          )
          if (marketBrier != null) {
            memberScores.push({ model: MARKET_MEMBER, mode: SENTINEL_MODE, brierScore: marketBrier, promptVersion: null })
          }

          for (const ms of memberScores) {
            await tx.aiMemberScore.upsert({
              where: {
                commitmentId_model_mode: {
                  commitmentId: commitment.id,
                  model: ms.model,
                  mode: ms.mode,
                },
              },
              create: {
                predictionId: prediction.id,
                commitmentId: commitment.id,
                model: ms.model,
                mode: ms.mode,
                brierScore: ms.brierScore,
                promptVersion: ms.promptVersion,
              },
              update: { brierScore: ms.brierScore, promptVersion: ms.promptVersion },
            })
          }
        }
      }

      await tx.commitment.update({
        where: { id: commitment.id },
        data: {
          rsChange,
          ...(brierScore !== null && { brierScore }),
          ...(peerScore !== null && { peerScore }),
          ...(aiScore !== null && { aiScore }),
          ...(klDivergence !== null && { klDivergence }),
        },
      })

      const newRs = Math.max(0, commitment.user.rs + rsChange)
      await tx.user.update({
        where: { id: commitment.userId },
        data: { rs: newRs },
      })

      if (brierScore !== null) {
        const isCorrect = brierScore < 0.25
        await applyGlicko2Update(tx, commitment.userId, commitment.user, brierScore, isCorrect)
      }
    }

    // Boundary between the two phases the resolution UI already shows a step
    // label for ("Scoring commitments…" / "Updating ratings…", daatan#1139):
    // everything above is per-commitment Brier/RS/Glicko-2 scoring, everything
    // below is the ELO + per-tag rating write-back.
    const tUpdatingStart = Date.now()
    const scoringMs = tUpdatingStart - tScoringStart

    // ELO: pairwise updates for all commitments with a brierScore
    if (eloInputs.length >= 2) {
      const eloDeltas = calculateEloUpdates(eloInputs)

      for (const [userId, delta] of eloDeltas) {
        await tx.user.update({
          where: { id: userId },
          data: { eloRating: { increment: delta } },
        })
      }

      for (const commitment of prediction.commitments) {
        const delta = eloDeltas.get(commitment.userId)
        if (delta !== undefined) {
          await tx.commitment.update({
            where: { id: commitment.id },
            data: { eloChange: delta },
          })
        }
      }
    }

    // Per-tag ELO + Glicko-2: update stored tag ratings for all tags on this prediction
    if (!isVoidOutcome && prediction.tags.length > 0) {
      await updateTagRatingsInTx(tx, prediction.tags, eloInputs)
    }

    return { prediction: updatedPrediction, scoringMs, updatingMs: Date.now() - tUpdatingStart }
  },
  // Prisma's default interactive-transaction timeout is 5s. Resolution does several
  // sequential writes per commitment (RS/Glicko/ELO plus up to 7 ai_member_scores
  // upserts), so a heavily-committed forecast can legitimately exceed that — and a
  // timeout here rolls back the entire resolution.
  { timeout: 60_000 })

  log.info(
    { predictionId, outcome, commitmentCount: prediction.commitments.length },
    'Prediction resolved',
  )

  // Freeze what the system published, for calibration (daatan#1233). Binaries
  // only — a multiple-choice forecast has no single probability to score — and
  // never for void/unresolvable, which have no outcome to score against.
  //
  // Outside the transaction on purpose: this is a research row, and a defect in
  // it must not be able to roll back a resolution. recordCalibration never
  // throws for the same reason, and awaiting it keeps the write ordered before
  // the response without making the resolution depend on it.
  if (!isVoidOutcome && !isMultipleChoice) {
    await recordCalibration({
      predictionId,
      outcome: outcome as 'correct' | 'wrong',
      resolvedAt: resolvedPrediction.resolvedAt ?? new Date(),
      // daatan#1234 check #3: the resolver only reached this point by explicitly
      // acknowledging the pin/estimate disagreement (the gate above) — flag the
      // record so a calibration fit can annotate or exclude the pair instead of
      // scoring it as a plain miss.
      disputed: pinContradiction.contradicts,
      disputeNote: pinContradiction.contradicts
        ? `Oracle ${pinContradiction.isSettled ? 'settled' : 'estimated'} this '${pinContradiction.impliedOutcome}' at confidence=${prediction.confidence}; resolver declared '${outcome}'`
        : undefined,
    })
  }

  if (prediction.isPublic) notifySearchEngines(prediction.slug ?? prediction.id)

  return { result: resolvedPrediction, prediction, timings: { scoringMs, updatingMs } }
}
