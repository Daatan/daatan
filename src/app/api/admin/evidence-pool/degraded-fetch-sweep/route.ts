import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import {
  degradedFetchWhere,
  sweepDegradedFetchRows,
  buildDegradedFetchDiffReport,
} from '@/lib/services/degraded-fetch-backfill'

const MAX_PER_CALL = 10

function parseLimit(request: NextRequest): number {
  return Math.min(MAX_PER_CALL, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 3))
}

/**
 * Read-only preview (daatan#1446 Step 2/3 machinery): counts rows/predictions
 * currently matching `degradedFetchWhere()` — the broader, unconfirmed superset of
 * the 17:41 comment's 432-row confirmed population (see the filter's own doc comment
 * for why it isn't the row-level join itself). Never calls the Oracle; safe to hit
 * any time to see how the candidate set is trending as more rows age past the cutoff
 * or get re-extracted by other paths.
 */
export const GET = withAuth(async () => {
  try {
    const where = degradedFetchWhere()
    const [rows, groups] = await Promise.all([
      prisma.evidencePoolArticle.count({ where }),
      prisma.evidencePoolArticle.groupBy({ by: ['predictionId'], where, _count: { _all: true } }),
    ])
    return NextResponse.json({ rows, predictions: groups.length })
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
 * sweep — each prediction is one full Oracle analysis.
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const result = await sweepDegradedFetchRows(parseLimit(request))
    return NextResponse.json({ ...result, report: buildDegradedFetchDiffReport(result.diffs) })
  } catch (error) {
    return handleRouteError(error, 'Degraded-fetch sweep failed')
  }
}, { roles: ['ADMIN'] })
