import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { prisma } from '@/lib/prisma'
import { ensurePunditTagRatingsSeeded } from '@/lib/services/tag-ratings'
import { PREVIOUS_PUNDIT_SCORING_VERSION, PUNDIT_SCORING_VERSION } from '@/lib/services/pundit-rating'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-recalculate-pundit-ratings')

type RatingRow = Awaited<ReturnType<typeof prisma.punditTagRating.findMany>>[number]

/** The part of a rating row that is the published result — not its id or write time. */
function ratingFingerprint(rows: RatingRow[]): string {
  return JSON.stringify(
    rows
      .map((r) => [r.personId, r.elo, r.mu, r.sigma, r.volatility, r.totalPredictions, r.correctPredictions])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
}

/**
 * Keep the rows this recalculation is about to delete (daatan#2144). The first archive for a
 * tag holds rows computed before the outcome cutoff existed, so it is labelled with the
 * previous rule set; every later one was produced by the current rules.
 */
async function archiveCurrentRatings(tagId: string): Promise<{ rows: RatingRow[]; archiveId: string | null }> {
  const rows = await prisma.punditTagRating.findMany({ where: { tagId } })
  if (rows.length === 0) return { rows, archiveId: null }
  const priorArchives = await prisma.punditTagRatingArchive.count({ where: { tagId } })
  const archive = await prisma.punditTagRatingArchive.create({
    data: {
      tagId,
      scoringVersion: priorArchives === 0 ? PREVIOUS_PUNDIT_SCORING_VERSION : PUNDIT_SCORING_VERSION,
      payload: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    },
    select: { id: true },
  })
  return { rows, archiveId: archive.id }
}

async function recalculate(tagSlug: string) {
  const tag = await prisma.tag.findUnique({ where: { slug: tagSlug }, select: { id: true } })
  if (!tag) {
    return NextResponse.json({ error: `No tag found for slug "${tagSlug}"` }, { status: 404 })
  }

  const started = Date.now()
  log.info({ tagSlug }, 'Pundit rating recalculation started')

  const before = await archiveCurrentRatings(tag.id)
  await prisma.punditTagRating.deleteMany({ where: { tagId: tag.id } })
  await ensurePunditTagRatingsSeeded(tag.id, tagSlug)

  const after = await prisma.punditTagRating.findMany({ where: { tagId: tag.id } })
  const changed = ratingFingerprint(before.rows) !== ratingFingerprint(after)
  // An archive of rows identical to what replaced them records nothing. Dropping it keeps
  // the table a list of real changes instead of one row per daily run.
  if (!changed && before.archiveId) {
    await prisma.punditTagRatingArchive.delete({ where: { id: before.archiveId } })
  }

  const elapsedMs = Date.now() - started
  log.info({ tagSlug, count: after.length, changed, elapsedMs }, 'Pundit rating recalculation complete')

  return NextResponse.json({
    tagSlug,
    updated: after.length,
    changed,
    scoringVersion: PUNDIT_SCORING_VERSION,
    elapsedMs,
  })
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    const tagSlug = new URL(request.url).searchParams.get('tag') ?? 'israeli-elections-2026'
    return await recalculate(tagSlug)
  } catch (error) {
    return handleRouteError(error, 'Pundit rating recalculation failed')
  }
}, { roles: ['ADMIN'] })

/**
 * POST /api/admin/pundit-ratings/recalculate?tag=israeli-elections-2026
 *
 * PunditTagRating has no incremental update hook (pundits don't commit, so
 * there's no resolution transaction to attach to — see docs/DATABASE.md) and
 * elections' read-only subset schema can never write to trigger a seed
 * itself. This is the only way pundit ratings get (re)computed: archives the
 * tag's existing rows (pundit_tag_rating_archives), deletes them, then replays
 * full history via ensurePunditTagRatingsSeeded. The replay scores only
 * readings published before each forecast's outcome cutoff (daatan#2144), so
 * no run — scheduled or manual — can bring post-outcome readings back.
 * Idempotent — safe to run any time, e.g. after a batch of predictions resolves.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header so
 * the recalculate workflow can drive it headlessly (daatan#1293) — same
 * pattern as backfill-oracle-sources/route.ts.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      const tagSlug = new URL(request.url).searchParams.get('tag') ?? 'israeli-elections-2026'
      return await recalculate(tagSlug)
    } catch (error) {
      return handleRouteError(error, 'Pundit rating recalculation failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
