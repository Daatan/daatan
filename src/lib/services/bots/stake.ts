/**
 * Shared create-publish-stake path for bot forecasts (both the news-anchored
 * and the sourceless generation paths). Builds the prediction, publishes it at
 * the right status for the bot's approval workflow, stakes when approval is not
 * required, and fires the embedding job. Throws on stake-transaction failure so
 * the caller can log and bail.
 */
import { prisma } from '@/lib/prisma'
import { embedAndStoreForecast } from '@/lib/services/embedding'
import {
  createCommitment,
  emitCreateCommitmentSideEffects,
  type CommitmentPrediction,
} from '@/lib/services/commitment'
import { type BotWithUser, randomInt } from './shared'

type PredictionCreateData = Parameters<typeof prisma.prediction.create>[0]['data']

/**
 * Create + publish a bot forecast, staking when approval isn't required.
 * Returns the created prediction and the staked amount (null when staking was
 * deferred for approval). Throws if the create+stake transaction fails.
 */
export async function createAndStake(
  bot: BotWithUser,
  predictionCreateData: PredictionCreateData,
): Promise<{ prediction: { id: string }; stakeAmount: number | null }> {
  // If requireApprovalForForecasts is true, create as PENDING_APPROVAL (don't stake yet).
  // If autoApprove is true, go directly to ACTIVE. Otherwise PENDING_APPROVAL (standard bot behavior).
  const publishStatus = bot.requireApprovalForForecasts ? 'PENDING_APPROVAL' : (bot.autoApprove ? 'ACTIVE' : 'PENDING_APPROVAL')

  let prediction: { id: string }
  let stakeAmount: number | null = null

  if (bot.requireApprovalForForecasts) {
    prediction = await prisma.$transaction(async (tx) => {
      const pred = await tx.prediction.create({ data: predictionCreateData })
      await tx.prediction.update({
        where: { id: pred.id },
        data: { status: publishStatus, publishedAt: new Date() },
      })
      return pred
    })
  } else {
    const stake = randomInt(bot.stakeMin, bot.stakeMax)
    stakeAmount = stake
    const out = await prisma.$transaction(async (tx) => {
      const pred = await tx.prediction.create({ data: predictionCreateData })
      await tx.prediction.update({
        where: { id: pred.id },
        data: { status: publishStatus, publishedAt: new Date() },
      })
      const stakeResult = await createCommitment(bot.userId, pred.id, { confidence: stake }, { tx })
      if (!stakeResult.ok) throw new Error(stakeResult.error ?? 'Commitment failed')
      return { prediction: pred, stakeResult }
    })
    prediction = out.prediction
    emitCreateCommitmentSideEffects(
      { ...out.prediction, options: [] } as CommitmentPrediction,
      out.stakeResult.data,
      { confidence: stake },
    )
  }

  // Fire-and-forget: store embedding for similar-forecast search
  embedAndStoreForecast(prediction.id, predictionCreateData.claimText).catch(() => {/* non-critical */})

  return { prediction, stakeAmount }
}
