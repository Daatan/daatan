import { NextResponse } from 'next/server'
import { resolvePredictionSchema } from '@/lib/validations/prediction'
import { apiError } from '@/lib/api-error'
import { toError } from '@/lib/utils/error'
import { withAuth } from '@/lib/api-middleware'
import { notifyForecastResolved } from '@/lib/services/telegram'
import { notifyNewsIndexerResolution } from '@/lib/services/news-indexer'
import { createNotification } from '@/lib/services/notification'
import { resolvePrediction } from '@/lib/services/prediction-resolution'
import { pushCredibilityFeedback } from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('forecast-resolve')

export const POST = withAuth(async (request, user, { params }) => {
  const body = await request.json()
  const { outcome, evidenceLinks, resolutionNote, correctOptionId, resolutionOverrodePin } = resolvePredictionSchema.parse(body)

  let resolveResult: Awaited<ReturnType<typeof resolvePrediction>>
  try {
    resolveResult = await resolvePrediction(params.id, {
      outcome,
      resolvedById: user.id,
      evidenceLinks,
      resolutionNote,
      correctOptionId,
      resolutionOverrodePin,
    })
  } catch (err) {
    const e = toError(err) as Error & { statusCode?: number }
    if (e.statusCode) return apiError(e.message, e.statusCode)
    throw err
  }
  const { result, prediction, timings } = resolveResult

  notifyForecastResolved(prediction, outcome, prediction.commitments.length)

  // Forecast-level probabilities (0–1) so the crowd & our model join the news-indexer
  // reliability ELO ladder. Only meaningful for BINARY; community = mean of the crowd's
  // committed P(YES), AI = the denormalized Oracul estimate (prediction.confidence, 0–100).
  let communityProbability: number | null = null
  let aiProbability: number | null = null
  if (prediction.outcomeType === 'BINARY') {
    const probs = prediction.commitments
      .map((c) => c.probability)
      .filter((p): p is number => p != null)
    if (probs.length > 0) {
      communityProbability = probs.reduce((a, b) => a + b, 0) / probs.length
    }
    if (prediction.confidence != null) {
      aiProbability = prediction.confidence / 100
    }
  }
  notifyNewsIndexerResolution(prediction.id, outcome, communityProbability, aiProbability)

  // Credibility feedback loop (retro docs/ORACLE_VARIABLES.md §9) — BINARY
  // only, stance has no clean meaning for a MULTIPLE_CHOICE option's
  // correctness; void/unresolvable have no outcome to score sources against.
  if (prediction.outcomeType === 'BINARY' && (outcome === 'correct' || outcome === 'wrong')) {
    pushCredibilityFeedback(prediction.id, outcome === 'correct', result.resolvedAt ?? new Date()).catch((err) =>
      log.warn({ predictionId: prediction.id, err }, 'credibility feedback push failed'),
    )
  }

  const forecastLink = `/forecasts/${prediction.slug || prediction.id}`
  // A commitment only loses its userId once its prediction has resolved
  // (daatan#1701 "Forget History"), so nothing here is anonymized yet — but
  // the schema's now-nullable Commitment.userId still needs this guard.
  for (const commitment of prediction.commitments) {
    if (!commitment.userId) continue
    createNotification({
      userId: commitment.userId,
      type: 'COMMITMENT_RESOLVED',
      title: 'Your committed forecast was resolved',
      message: `"${prediction.claimText.substring(0, 80)}" was resolved as ${outcome}`,
      link: forecastLink,
      predictionId: prediction.id,
      actorId: user.id,
    })
  }

  return NextResponse.json({ ...result, timings })
}, { roles: ['ADMIN', 'RESOLVER'] })
