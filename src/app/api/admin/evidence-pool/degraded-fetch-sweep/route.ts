import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import {
  degradedFetchWhere,
  sweepDegradedFetchRows,
  buildDegradedFetchDiffReport,
  type DegradedFetchWhereOptions,
} from '@/lib/services/degraded-fetch-backfill'
import { CONFIRMED_DEGRADED_URL_HASHES } from '@/lib/services/confirmed-degraded-urls'

const MAX_PER_CALL = 10

function parseLimit(request: NextRequest): number {
  return Math.min(MAX_PER_CALL, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 3))
}

/**
 * Both GET and POST scope to the confirmed url_hash allowlist by default — the
 * row-level population the 17:41 log join proved degraded (402 rows), not the
 * 1,605-row domain superset the original filter shape selects. `?filter=domains`
 * keeps the superset reachable for preview/comparison; the sweep itself always
 * runs on the allowlist.
 */
function parseWhereOptions(request: NextRequest): DegradedFetchWhereOptions {
  const filter = new URL(request.url).searchParams.get('filter')
  return filter === 'domains' ? {} : { urlHashAllowlist: CONFIRMED_DEGRADED_URL_HASHES }
}

/**
 * Read-only preview (daatan#1446 Step 2/3 machinery): counts rows/predictions
 * currently matching the sweep's filter — by default the confirmed url_hash
 * allowlist (see parseWhereOptions); `?filter=domains` shows the legacy domain
 * superset for comparison. Never calls the Oracul; safe to hit any time to see
 * how the candidate set is trending as rows get re-extracted.
 *
 * `rows` splits into `reachable` (null contentHash — actually re-extractable) and
 * `gated` (non-null — the sweep re-sends each row's OWN stored title+snippet, so a
 * non-null hash re-hashes to itself and no-ops every time). Without this split,
 * `rows` overstates what the sweep can move: daatan#1466 measured 137 of a
 * 140-row residual as permanently gated, with the preview giving no hint of it.
 */
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const where = degradedFetchWhere(parseWhereOptions(request))
    const [rows, reachable, groups] = await Promise.all([
      prisma.evidencePoolArticle.count({ where }),
      prisma.evidencePoolArticle.count({ where: { ...where, contentHash: null } }),
      prisma.evidencePoolArticle.groupBy({ by: ['predictionId'], where, _count: { _all: true } }),
    ])
    return NextResponse.json({ rows, reachable, gated: rows - reachable, predictions: groups.length })
  } catch (error) {
    return handleRouteError(error, 'Degraded-fetch sweep preview failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Runs the re-extraction sweep (`sweepDegradedFetchRows`) and returns its result
 * plus the before/after movement report (`buildDegradedFetchDiffReport`), sorted by
 * how far each affected prediction's AI estimate moved.
 *
 * **Deliberately no `x-cron-secret` path** — unlike evidence-pool/retry, this isn't
 * meant to run headlessly on a schedule. Per the issue: "a large swing on a live
 * forecast is a product decision, not cleanup." An ADMIN calls this by hand, reads
 * the report, and decides whether the results should stand. Bounded per call
 * (?limit=N predictions, default 3, max 10) for the same pacing reason as the retry
 * sweep — each prediction is one full Oracul analysis.
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const result = await sweepDegradedFetchRows(parseLimit(request), {
      urlHashAllowlist: CONFIRMED_DEGRADED_URL_HASHES,
    })
    return NextResponse.json({ ...result, report: buildDegradedFetchDiffReport(result.diffs) })
  } catch (error) {
    return handleRouteError(error, 'Degraded-fetch sweep failed')
  }
}, { roles: ['ADMIN'] })
