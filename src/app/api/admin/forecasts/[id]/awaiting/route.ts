import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { dismissAwaitingResolution } from '@/lib/services/context'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/admin/forecasts/[id]/awaiting
 * Dismiss a forecast from the Awaiting Resolution queue (daatan#1659). Sticky
 * until the AI estimate actually moves — see `dismissAwaitingResolution`.
 * Admin-gated.
 */
export const DELETE = withAuth(
  async (_request, user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { awaitingAiResolution: true, status: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)
    if (!prediction.awaitingAiResolution) return apiError('Forecast is not awaiting resolution', 409)
    if (prediction.status !== 'ACTIVE') return apiError('Only ACTIVE forecasts can be dismissed', 409)

    await dismissAwaitingResolution(params.id, user.id)
    return NextResponse.json({ ok: true })
  },
  { roles: ['ADMIN'] },
)
