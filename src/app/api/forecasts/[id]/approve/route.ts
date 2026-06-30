import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { getForecastById, approveForecast } from '@/lib/services/forecast'
import { createCommitment } from '@/lib/services/commitment'
import { notifyBotForecastApproved } from '@/lib/services/telegram'
import { findUserBasicInfo } from '@/lib/services/user'
import { getBotConfigByUserId } from '@/lib/services/bot'
import { createLogger } from '@/lib/logger'

const log = createLogger('approve-route')

export const dynamic = 'force-dynamic'

// POST /api/forecasts/[id]/approve - Approve a PENDING_APPROVAL forecast and stake on it
export const POST = withAuth(async (_request, user, { params }) => {
  const blocked = blockedOnSelfHost()
  if (blocked) return blocked
  try {
    const prediction = await getForecastById(params.id)

    if (!prediction) {
      return apiError('Prediction not found', 404)
    }

    if (!prediction.author.isBot) {
      return apiError('Only bot-created forecasts can be approved via this endpoint', 400)
    }

    if (prediction.status !== 'PENDING_APPROVAL') {
      return apiError('Forecast is not awaiting approval', 400)
    }

    const updated = await approveForecast(params.id)

    const botConfig = await getBotConfigByUserId(prediction.author.id)
    if (botConfig) {
      const stakeAmount = Math.floor(Math.random() * (botConfig.stakeMax - botConfig.stakeMin + 1)) + botConfig.stakeMin
      const stakeResult = await createCommitment(prediction.author.id, prediction.id, {
        confidence: stakeAmount,
      })

      if (!stakeResult.ok) {
        log.warn(
          { botId: prediction.author.id, predictionId: prediction.id, error: stakeResult.error },
          'Failed to stake on approved forecast'
        )
      }
    }

    const approver = await findUserBasicInfo(user.id)
    if (approver) {
      notifyBotForecastApproved(updated, updated.author, approver)
    }

    return NextResponse.json(updated)
  } catch (error) {
    return handleRouteError(error, 'Failed to approve prediction')
  }
}, { roles: ['ADMIN', 'APPROVER'] })
