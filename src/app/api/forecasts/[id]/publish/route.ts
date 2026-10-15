import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getForecastById, publishForecast } from '@/lib/services/forecast'
import { notifyForecastPublished } from '@/lib/services/telegram'
import { MIN_RESOLUTION_RULES_LENGTH } from '@/lib/resolution-rules'

export const dynamic = 'force-dynamic'

// POST /api/forecasts/[id]/publish - Publish a forecast (DRAFT → ACTIVE)
export const POST = withAuth(async (_request, user, { params }) => {
  try {
    const prediction = await getForecastById(params.id)

    if (!prediction) {
      return apiError('Prediction not found', 404)
    }

    if (prediction.authorId !== user.id) {
      return apiError('Forbidden', 403)
    }

    if (prediction.status !== 'DRAFT') {
      return apiError('Prediction is already published', 400)
    }

    if (!prediction.claimText || prediction.claimText.length < 10) {
      return apiError('Claim text must be at least 10 characters', 400)
    }

    if (!prediction.resolutionRules || prediction.resolutionRules.trim().length < MIN_RESOLUTION_RULES_LENGTH) {
      return apiError(`Resolution rules are required to publish (minimum ${MIN_RESOLUTION_RULES_LENGTH} characters)`, 400)
    }

    if (prediction.resolveByDatetime <= new Date()) {
      return apiError('Resolution date must be in the future', 400)
    }

    if (prediction.outcomeType === 'MULTIPLE_CHOICE' && prediction.options.length < 2) {
      return apiError('Multiple choice predictions need at least 2 options', 400)
    }

    const updated = await publishForecast(params.id)

    notifyForecastPublished(updated, updated.author)

    return NextResponse.json(updated)
  } catch (error) {
    return handleRouteError(error, 'Failed to publish prediction')
  }
})
