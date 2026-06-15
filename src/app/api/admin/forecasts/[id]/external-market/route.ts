import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveMarketByUrl, suggestMarketsForClaim } from '@/lib/services/external-markets'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-forecast-external-market')

export const dynamic = 'force-dynamic'

const linkSchema = z.object({ url: z.string().min(1) })

/**
 * GET /api/admin/forecasts/[id]/external-market
 * Candidate markets (Polymarket / Kalshi) matching the forecast's claim.
 * Suggestion only — an admin still confirms via POST. Admin-gated.
 */
export const GET = withAuth(
  async (_request, _user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { claimText: true, extractedEntities: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)

    const suggestions = await suggestMarketsForClaim(
      prediction.claimText,
      prediction.extractedEntities,
    )
    return NextResponse.json({ suggestions })
  },
  { roles: ['ADMIN'] },
)

/**
 * POST /api/admin/forecasts/[id]/external-market  body: { url }
 * Resolve a pasted market URL (Polymarket / Kalshi) and link it (manual link).
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
    if (!market) return apiError('Could not resolve a market from that URL', 422)

    await prisma.prediction.update({
      where: { id: params.id },
      data: {
        externalMarketId: market.id,
        externalMarketLinkedAt: new Date(),
        externalMarketLinkMethod: 'manual',
      },
    })
    log.info({ predictionId: params.id, marketId: market.id }, 'Linked external market')
    return NextResponse.json({ market })
  },
  { roles: ['ADMIN'] },
)

/**
 * DELETE /api/admin/forecasts/[id]/external-market — unlink the market.
 */
export const DELETE = withAuth(
  async (_request, _user, { params }) => {
    await prisma.prediction.update({
      where: { id: params.id },
      data: {
        externalMarketId: null,
        externalMarketLinkedAt: null,
        externalMarketLinkMethod: null,
      },
    })
    log.info({ predictionId: params.id }, 'Unlinked external market')
    return NextResponse.json({ ok: true })
  },
  { roles: ['ADMIN'] },
)
