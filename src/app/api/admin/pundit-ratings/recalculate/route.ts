import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { ensurePunditTagRatingsSeeded } from '@/lib/services/tag-ratings'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-recalculate-pundit-ratings')

/**
 * POST /api/admin/pundit-ratings/recalculate?tag=israeli-elections-2026
 *
 * PunditTagRating has no incremental update hook (pundits don't commit, so
 * there's no resolution transaction to attach to — see docs/DATABASE.md) and
 * elections' read-only subset schema can never write to trigger a seed
 * itself. This is the only way pundit ratings get (re)computed: deletes the
 * tag's existing rows, then replays full history via
 * ensurePunditTagRatingsSeeded. Idempotent — safe to run any time, e.g. after
 * a batch of predictions resolves.
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const tagSlug = new URL(request.url).searchParams.get('tag') ?? 'israeli-elections-2026'
    const tag = await prisma.tag.findUnique({ where: { slug: tagSlug }, select: { id: true } })
    if (!tag) {
      return NextResponse.json({ error: `No tag found for slug "${tagSlug}"` }, { status: 404 })
    }

    const started = Date.now()
    log.info({ tagSlug }, 'Pundit rating recalculation started')

    await prisma.punditTagRating.deleteMany({ where: { tagId: tag.id } })
    await ensurePunditTagRatingsSeeded(tag.id, tagSlug)

    const count = await prisma.punditTagRating.count({ where: { tagId: tag.id } })
    const elapsedMs = Date.now() - started
    log.info({ tagSlug, count, elapsedMs }, 'Pundit rating recalculation complete')

    return NextResponse.json({ tagSlug, updated: count, elapsedMs })
  } catch (error) {
    return handleRouteError(error, 'Pundit rating recalculation failed')
  }
}, { roles: ['ADMIN'] })
