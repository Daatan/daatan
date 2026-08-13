import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { getPoolArticles } from '@/lib/services/evidence-pool'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/forecasts/[id]/evidence-pool
 * List a forecast's pooled articles, INCLUDING superseded versions (retro
 * docs/ORACLE_VARIABLES.md §6 part 2) — this is the admin's window onto the
 * correction history a version chain now makes visible (daatan#1381/#1383).
 * `excluded` is settable via PATCH on a single article.
 */
export const GET = withAuth(
  async (_request, _user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)

    const articles = await getPoolArticles(params.id, { includeSuperseded: true })
    return NextResponse.json({ articles })
  },
  { roles: ['ADMIN'] },
)
