import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError, apiError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { z } from 'zod'
import { getBotById, updateBot, disableBot } from '@/lib/services/bot'

export const dynamic = 'force-dynamic'

const updateBotSchema = z
  .object({
    personaPrompt: z.string().min(10).optional(),
    forecastPrompt: z.string().min(10).optional(),
    votePrompt: z.string().min(10).optional(),
    newsSources: z.array(z.string()).optional(),
    intervalMinutes: z.number().int().min(5).max(10080).optional(),
    maxForecastsPerDay: z.number().int().min(0).max(20).optional(),
    maxVotesPerDay: z.number().int().min(0).max(50).optional(),
    stakeMin: z.number().int().min(1).optional(),
    stakeMax: z.number().int().min(1).optional(),
    modelPreference: z.string().optional(),
    hotnessMinSources: z.number().int().min(1).optional(),
    hotnessWindowHours: z.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
    activeHoursStart: z.number().int().min(0).max(23).nullable().optional(),
    activeHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
    tagFilter: z.array(z.string().min(1)).optional(),
    voteBias: z.number().int().min(0).max(100).optional(),
    cuRefillAt: z.number().int().min(0).optional(),
    cuRefillAmount: z.number().int().min(1).optional(),
    canCreateForecasts: z.boolean().optional(),
    canVote: z.boolean().optional(),
    requireApprovalForForecasts: z.boolean().optional(),
    enableSentimentExtraction: z.boolean().optional(),
    enableRejectionTracking: z.boolean().optional(),
    showMetadataOnForecast: z.boolean().optional(),
    maxForecastsPerHour: z.number().int().min(0).optional(),
  })
  .refine(
    (d) => {
      const startSet = d.activeHoursStart != null
      const endSet = d.activeHoursEnd != null
      return startSet === endSet || (d.activeHoursStart === null && d.activeHoursEnd === null)
    },
    {
      message: 'activeHoursStart and activeHoursEnd must both be set or both be null',
      path: ['activeHoursStart'],
    },
  )

// PATCH /api/admin/bots/[id] — update bot config
export const PATCH = withAuth(
  async (request: NextRequest, _user, { params }) => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked
    try {
      const body = await request.json()
      const data = updateBotSchema.parse(body)

      const bot = await getBotById(params.id)
      if (!bot) return apiError('Bot not found', 404)

      const newMin = data.stakeMin ?? bot.stakeMin
      const newMax = data.stakeMax ?? bot.stakeMax
      if (newMin > newMax) {
        return NextResponse.json({ error: 'stakeMin must be ≤ stakeMax' }, { status: 400 })
      }

      const updated = await updateBot(params.id, data)

      return NextResponse.json({ bot: updated })
    } catch (err) {
      return handleRouteError(err, 'Failed to update bot')
    }
  },
  { roles: ['ADMIN'] },
)

// DELETE /api/admin/bots/[id] — disable (soft delete via isActive = false)
export const DELETE = withAuth(
  async (_request: NextRequest, _user, { params }) => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked
    try {
      const bot = await getBotById(params.id)
      if (!bot) return apiError('Bot not found', 404)

      await disableBot(params.id)

      return NextResponse.json({ ok: true })
    } catch (err) {
      return handleRouteError(err, 'Failed to disable bot')
    }
  },
  { roles: ['ADMIN'] },
)
