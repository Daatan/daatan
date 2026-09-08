import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { aiResearchEnabled } from '@/lib/capabilities'
import { runResolutionResearch } from '@/lib/services/resolutionResearch'
import { notifyBornTrueAtCreation } from '@/lib/services/telegram'

const log = createLogger('born-true-check')

/**
 * Fire-and-forget, called right after a forecast is created (daatan#1747):
 * re-runs the same born-true research leg a resolver's manual "AI Research"
 * button already uses (daatan#1511/#1515), but immediately after creation
 * instead of at resolve time. That leg always searches for evidence over the
 * whole claim window AND a leg strictly before the claim's creation date, so a
 * decisive verdict this soon after creation — before any real-world
 * development could plausibly have occurred — means the claim was already
 * true or false the moment it was created.
 *
 * This is exactly the retro#776 incident: "Chess.com will have more than
 * 500,000 registered users by Dec 31 2030" was created while the real count
 * was already 250M+, and nothing checked. That forecast was BINARY with the
 * threshold embedded only in free-text `claimText` (no structured
 * NUMERIC_THRESHOLD payload) — the research leg's LLM judgment already reads
 * `claimText` as a whole for both shapes, so no separate number-extraction
 * step is needed here.
 *
 * Never blocks or mutates the forecast — only posts a Telegram review row for
 * a human to correct or delete it. Must not throw: callers invoke this
 * fire-and-forget off the interactive creation response path.
 */
export async function checkBornTrueAtCreation(predictionId: string): Promise<void> {
  if (!aiResearchEnabled()) return

  // Queried directly (not via forecast.ts's getForecastForResearch) to avoid a
  // circular import: forecast.ts's createForecast is what schedules this check.
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: { options: true },
  })
  if (!prediction) return

  const result = await runResolutionResearch(prediction, {
    userId: prediction.authorId,
    source: 'born-true-check',
  })

  if (result.outcome !== 'correct' && result.outcome !== 'wrong') return

  notifyBornTrueAtCreation(
    { id: prediction.id, claimText: prediction.claimText, slug: prediction.slug },
    result.outcome,
    result.reasoning,
    result.evidenceLinks,
  )
}

/** Fire-and-forget wrapper for callers that just want to kick this off and move on. */
export function scheduleBornTrueCheck(predictionId: string): void {
  checkBornTrueAtCreation(predictionId).catch((err) =>
    log.error({ err, predictionId }, 'born-true check failed')
  )
}
