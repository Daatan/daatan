import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { getPoolArticles, isUsablePoolRow } from '@/lib/services/evidence-pool'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/forecasts/[id]/evidence-pool
 * List a forecast's pooled articles, INCLUDING superseded versions (retro
 * docs/ORACLE_VARIABLES.md §6 part 2) — this is the admin's window onto the
 * correction history a version chain now makes visible (daatan#1381/#1383).
 * `excluded` is settable via PATCH on a single article.
 *
 * `usableSize`/`poolSize` (daatan#1521) are counted over current-version
 * rows only (`supersededAt === null`), same semantics as
 * resolvePooledEstimate/recomputePoolAggregate — a superseded row's
 * correction history is included in `articles` for display but isn't a
 * distinct pool member.
 */
export const GET = withAuth(
  async (_request, _user, { params }) => {
    const prediction = await prisma.prediction.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!prediction) return apiError('Forecast not found', 404)

    const articles = await getPoolArticles(params.id, { includeSuperseded: true })
    const current = articles.filter(a => a.supersededAt === null)
    const usableSize = current.filter(isUsablePoolRow).length
    return NextResponse.json({ articles, poolSize: current.length, usableSize })
  },
  { roles: ['ADMIN'] },
)
