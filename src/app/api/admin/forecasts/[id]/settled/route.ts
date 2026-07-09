import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { clearSettledLatch } from '@/lib/services/context'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/admin/forecasts/[id]/settled
 * Clear a false-positive settlement latch (recordEstimate can only ever set
 * it true — see docs/DATABASE.md "Settlement latch"). Admin-gated.
 */
export const DELETE = withAuth(
  async (_request, user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { settled: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)
    if (!prediction.settled) return apiError('Forecast is not settled', 409)

    await clearSettledLatch(params.id, user.id)
    return NextResponse.json({ ok: true })
  },
  { roles: ['ADMIN'] },
)
