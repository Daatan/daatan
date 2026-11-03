import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { createLogger } from '@/lib/logger'
import { retractCredibilityFeedback } from '@/lib/services/evidence-pool'
import { notifyNewsIndexerUnresolve } from '@/lib/services/news-indexer'
import { unresolvePrediction } from '@/lib/services/prediction-unresolve'
import { toError } from '@/lib/utils/error'
import { unresolvePredictionSchema } from '@/lib/validations/prediction'

const log = createLogger('forecast-unresolve')

// Revert a mistaken resolution (daatan#2077).
export const POST = withAuth(async (request, user, { params }) => {
  const parsed = unresolvePredictionSchema.safeParse(await request.json())
  if (!parsed.success) return apiError('A reason is required', 400)

  let reverted: Awaited<ReturnType<typeof unresolvePrediction>>
  try {
    reverted = await unresolvePrediction(params.id, user.id, parsed.data.reason)
  } catch (err) {
    const e = toError(err) as Error & { statusCode?: number }
    if (e.statusCode) return apiError(e.message, e.statusCode)
    throw err
  }

  // Both are idempotent, so a repeat is harmless, and neither can fail the revert: Daatan's
  // own state is already correct. Same gate as the push in the resolve route.
  notifyNewsIndexerUnresolve(params.id)
  if (reverted.outcomeType === 'BINARY' && (reverted.revertedOutcome === 'correct' || reverted.revertedOutcome === 'wrong')) {
    retractCredibilityFeedback(params.id).catch((err) =>
      log.warn({ predictionId: params.id, err }, 'credibility feedback retract failed'),
    )
  }

  return NextResponse.json({ status: reverted.prediction.status })
}, { roles: ['ADMIN'] })
