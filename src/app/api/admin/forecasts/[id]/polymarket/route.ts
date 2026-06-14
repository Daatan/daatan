import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveMarketByUrl, suggestMarkets } from '@/lib/services/polymarket'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-forecast-polymarket')

export const dynamic = 'force-dynamic'

const linkSchema = z.object({ url: z.string().min(1) })

/**
 * GET /api/admin/forecasts/[id]/polymarket
 * AI/keyword suggestions for markets matching the forecast's claim. Suggestion
 * only — an admin still confirms via POST. Admin-gated.
 */
export const GET = withAuth(
  async (_request, _user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { claimText: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)

    const suggestions = await suggestMarkets(prediction.claimText)
    return NextResponse.json({ suggestions })
  },
  { roles: ['ADMIN'] },
)

/**
 * POST /api/admin/forecasts/[id]/polymarket  body: { url }
 * Resolve a pasted Polymarket URL and link it to the forecast (manual link).
 */
export const POST = withAuth(
  async (request, _user, { params }) => {
    const { url } = linkSchema.parse(await request.json())

    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)

    const market = await resolveMarketByUrl(url)
    if (!market) return apiError('Could not resolve a Polymarket market from that URL', 422)

    await prisma.prediction.update({
      where: { id: params.id },
      data: {
        polymarketMarketId: market.id,
        polymarketLinkedAt: new Date(),
        polymarketLinkMethod: 'manual',
      },
    })
    log.info({ predictionId: params.id, marketId: market.id }, 'Linked Polymarket market')
    return NextResponse.json({ market })
  },
  { roles: ['ADMIN'] },
)

/**
 * DELETE /api/admin/forecasts/[id]/polymarket — unlink the market.
 */
export const DELETE = withAuth(
  async (_request, _user, { params }) => {
    await prisma.prediction.update({
      where: { id: params.id },
      data: {
        polymarketMarketId: null,
        polymarketLinkedAt: null,
        polymarketLinkMethod: null,
      },
    })
    log.info({ predictionId: params.id }, 'Unlinked Polymarket market')
    return NextResponse.json({ ok: true })
  },
  { roles: ['ADMIN'] },
)
