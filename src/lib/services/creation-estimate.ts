import { prisma } from '@/lib/prisma'
import { getOracleConfig } from '@/lib/services/oracleClient'
import { refreshOracleSnapshot } from '@/lib/services/oracle-backfill'
import { createLogger } from '@/lib/logger'

const log = createLogger('creation-estimate')

const inFlight = new Set<string>()

/**
 * First real Oracul estimate for a just-created forecast (daatan#1777).
 *
 * Until this existed, the only number a new forecast carried was the express
 * generator's own `probabilitySuggestion` — an ungrounded LLM guess that hedges to
 * 50 when it has nothing — and the Oracul was only ever asked if a news-indexer push
 * happened to match. A forecast no push matched kept that 50 indefinitely.
 *
 * Runs the same search → Oracul → pool path as the active-forecast backfill.
 * Needs two things, which arrive in either order: the row is ACTIVE + public (same
 * filter as the backfill: a DRAFT may never be published, and a moderation-flagged
 * forecast shouldn't spend an Oracul run), and the temporal classifier has written
 * claimDirection/claimDeadline/claimArchetype (retro folds those into its
 * forecast_cache key and direction guard, so an unclassified run would re-extract on
 * a different key than every later push). So it is scheduled from both ends — after
 * classification in createForecast, and on publish/approve — and whichever call
 * finds both conditions met does the run. Each caller writes its own condition
 * before this re-reads the row, so at least one of them sees both.
 * Never throws.
 */
export async function runCreationEstimate(predictionId: string): Promise<void> {
  if (!getOracleConfig()) return

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: {
      id: true,
      status: true,
      isPublic: true,
      outcomeType: true,
      claimText: true,
      claimDirection: true,
      claimDeadline: true,
      createdAt: true,
      claimArchetype: true,
      resolutionRules: true,
      classifiedAt: true,
    },
  })
  if (!prediction || prediction.status !== 'ACTIVE' || !prediction.isPublic) return
  if (!prediction.classifiedAt) return
  // The needle and badge are BINARY-only; a multiple-choice forecast has no
  // single probability for this to set.
  if (prediction.outcomeType !== 'BINARY') return
  // Both triggers can pass the checks above when publish lands right as the
  // classifier finishes, and a re-publish calls this again. Call logs are written
  // only once a call returns, so a run still in flight is tracked in-process.
  if (inFlight.has(predictionId)) return
  inFlight.add(predictionId)
  try {
    const already = await prisma.oracleCallLog.count({
      where: { predictionId, source: 'creation-estimate' },
    })
    if (already > 0) return

    const r = await refreshOracleSnapshot(prediction, {
      origin: 'creation',
      source: 'creation-estimate',
      reask: true,
    })
    log.info({ predictionId, status: r.status }, 'creation-estimate.done')
  } finally {
    inFlight.delete(predictionId)
  }
}

/** Fire-and-forget wrapper for createForecast and publish/approve. */
export function scheduleCreationEstimate(predictionId: string): void {
  runCreationEstimate(predictionId).catch((err) =>
    log.error({ err, predictionId }, 'creation estimate failed'),
  )
}
