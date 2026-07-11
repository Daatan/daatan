import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { applyGlicko2Update } from '@/lib/services/expertise'
import { calculateEloUpdates } from '@/lib/services/elo'
import { computeMemberScores } from '@/lib/services/ai-panel-score'
import { updateTagRatingsInTx } from '@/lib/services/tag-ratings'
import { notifySearchEngines } from '@/lib/services/indexnow'

const log = createLogger('prediction-resolution')

export type ResolutionOutcome = 'correct' | 'wrong' | 'void' | 'unresolvable'

interface ResolutionOptions {
  outcome: ResolutionOutcome
  resolvedById: string
  evidenceLinks?: string[]
  resolutionNote?: string
  correctOptionId?: string
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
  const { outcome, resolvedById, evidenceLinks, resolutionNote, correctOptionId } = options

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: {
      tags: { select: { id: true } },
      options: true,
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
          // (docs/AI_PANEL.md §7). Null on commitments placed before the first run.
          aiRunAtCommit: {
            select: { estimates: { select: { model: true, probability: true } } },
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

  let newStatus: 'RESOLVED_CORRECT' | 'RESOLVED_WRONG' | 'VOID' | 'UNRESOLVABLE'
  if (outcome === 'correct') newStatus = 'RESOLVED_CORRECT'
  else if (outcome === 'wrong') newStatus = 'RESOLVED_WRONG'
  else if (outcome === 'void') newStatus = 'VOID'
  else newStatus = 'UNRESOLVABLE'

  const isVoidOutcome = outcome === 'void' || outcome === 'unresolvable'

  const result = await prisma.$transaction(async (tx) => {
    const updatedPrediction = await tx.prediction.update({
      where: { id: predictionId },
      data: {
        status: newStatus,
        resolvedAt: new Date(),
        resolvedById,
        resolutionOutcome: outcome,
        evidenceLinks: evidenceLinks ?? undefined,
        resolutionNote,
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

        eloInputs.push({
          userId: commitment.userId,
          brierScore,
          eloRating: commitment.user.eloRating,
        })

        // Matched-time Brier for each panel member (and the Oracle) on this commitment.
        // Isolation: written to ai_member_scores only; never touches this user's score.
        const memberScores = computeMemberScores(
          commitment.aiRunAtCommit?.estimates ?? [],
          commitment.aiProbabilityAtCommit,
          outcomeNumeric,
        )
        for (const ms of memberScores) {
          await tx.aiMemberScore.upsert({
            where: { commitmentId_model: { commitmentId: commitment.id, model: ms.model } },
            create: {
              predictionId: prediction.id,
              commitmentId: commitment.id,
              model: ms.model,
              brierScore: ms.brierScore,
            },
            update: { brierScore: ms.brierScore },
          })
        }
      }

      await tx.commitment.update({
        where: { id: commitment.id },
        data: {
          rsChange,
          ...(brierScore !== null && { brierScore }),
          ...(peerScore !== null && { peerScore }),
          ...(aiScore !== null && { aiScore }),
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

    return updatedPrediction
  })

  log.info(
    { predictionId, outcome, commitmentCount: prediction.commitments.length },
    'Prediction resolved',
  )

  if (prediction.isPublic) notifySearchEngines(prediction.slug ?? prediction.id)

  return { result, prediction }
}
