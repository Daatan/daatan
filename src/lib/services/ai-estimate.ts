import { prisma } from '@/lib/prisma'
import { llmService } from '@/lib/llm'
import { withRetry } from '@/lib/utils/retry'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai-estimate')

/**
 * Fire-and-forget: ask the LLM for a probability estimate for a claim, then
 * backfill aiProbabilityAtCommit on the commitment row.
 * Called only when Prediction.confidence was null at commit time.
 */
export async function triggerAiProbabilityEstimate(
  commitmentId: string,
  claimText: string,
): Promise<void> {
  try {
    const probability = await withRetry(
      async () => {
        const response = await llmService.generateContent({
          prompt: `You are a calibrated forecasting assistant. Given the following prediction claim, estimate the probability (0–100) that it will resolve as TRUE/correct. Reply with ONLY a single integer between 0 and 100, nothing else.\n\nClaim: ${claimText}`,
          temperature: 0,
        })
        const text = response.text.trim()
        const value = parseInt(text, 10)
        if (isNaN(value) || value < 0 || value > 100) {
          throw new Error(`Unexpected LLM response: ${text}`)
        }
        return value / 100
      },
      { attempts: 3, initialDelayMs: 500 },
    )

    await prisma.commitment.update({
      where: { id: commitmentId },
      data: { aiProbabilityAtCommit: probability },
    })

    log.info({ commitmentId, probability }, 'AI probability estimate backfilled')
  } catch (err) {
    log.warn({ err, commitmentId }, 'AI probability estimate failed — leaving null')
  }
}
