import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { getForecastById, rejectForecast } from '@/lib/services/forecast'
import { notifyBotForecastRejected } from '@/lib/services/telegram'
import { findUserBasicInfo } from '@/lib/services/user'
import { rejectForecastSchema } from '@/lib/validations/prediction'
import { notifySearchEngines } from '@/lib/services/indexnow'

export const dynamic = 'force-dynamic'

// POST /api/forecasts/[id]/reject - Reject a PENDING_APPROVAL forecast
export const POST = withAuth(async (request, user, { params }) => {
  const blocked = blockedOnSelfHost()
  if (blocked) return blocked
  try {
    const body = await request.json()
    const { keywords, description } = rejectForecastSchema.parse(body)

    const prediction = await getForecastById(params.id)

    if (!prediction) {
      return apiError('Prediction not found', 404)
    }

    if (!prediction.author.isBot) {
      return apiError('Only bot-created forecasts can be rejected via this endpoint', 400)
    }

    if (prediction.status !== 'PENDING_APPROVAL') {
      return apiError('Forecast is not awaiting approval', 400)
    }

    const extractedKeywords = keywords || [
      ...prediction.claimText.toLowerCase().split(/\s+/).slice(0, 5),
    ]
    const topicDescription = description || prediction.claimText.substring(0, 200)

    const updated = await rejectForecast(params.id, {
      keywords: extractedKeywords,
      description: topicDescription,
      rejectorId: user.id,
      authorId: prediction.author.id,
    })

    const rejector = await findUserBasicInfo(user.id)
    if (rejector) {
      notifyBotForecastRejected(updated, updated.author, rejector)
    }

    notifySearchEngines(updated.slug ?? updated.id)

    return NextResponse.json({
      success: true,
      prediction: updated,
      message: 'Forecast rejected and topic added to rejection list',
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to reject prediction')
  }
}, { roles: ['ADMIN', 'APPROVER'] })
