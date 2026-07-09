import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { getPoolArticles } from '@/lib/services/evidence-pool'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/forecasts/[id]/evidence-pool
 * List a forecast's pooled articles (retro docs/ORACLE_VARIABLES.md §6 part 2).
 * Admin visibility only — nothing yet computes from this table (see
 * evidence-pool.ts); `excluded` is settable via PATCH on a single article but
 * not enforced until the recompute-over-pool cutover ships.
 */
export const GET = withAuth(
  async (_request, _user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)

    const articles = await getPoolArticles(params.id)
    return NextResponse.json({ articles })
  },
  { roles: ['ADMIN'] },
)
