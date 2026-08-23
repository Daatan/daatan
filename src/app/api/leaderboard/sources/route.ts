import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { handleRouteError } from '@/lib/api-error'
import {
  getSourceLeaderboard,
  type SourceLeaderboardView,
  type SourceSortBy,
} from '@/lib/services/sourceLeaderboard'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Rows below this sample size are too noisy to rank publicly (a single lucky/unlucky
// call shouldn't top or bottom the board) — see daatan#1587. Single-row lookups
// (/sources/[name], /authors/[author]/[outlet]) call getSourceLeaderboard directly
// with the default minPredictions=0 and are unaffected.
const MIN_PREDICTIONS = 5

// Shadow-scoring rows move slowly — 5min TTL matches /api/leaderboard's.
const getCachedSourceLeaderboard = unstable_cache(
  async (view: SourceLeaderboardView, sortBy: SourceSortBy) =>
    getSourceLeaderboard(view, sortBy, MIN_PREDICTIONS),
  ['leaderboard-sources-api'],
  { revalidate: 300, tags: ['leaderboard-sources'] },
)

// GET /api/leaderboard/sources - author/outlet shadow-scoring leaderboard
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`leaderboard-sources:${clientIp(request)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  try {
    const { searchParams } = new URL(request.url)
    const view: SourceLeaderboardView = searchParams.get('view') === 'outlets' ? 'outlets' : 'authors'
    const sortBy: SourceSortBy = searchParams.get('sortBy') === 'brierScore' ? 'brierScore' : 'skillConservative'
    const leaderboard = await getCachedSourceLeaderboard(view, sortBy)
    return NextResponse.json(leaderboard)
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch source leaderboard')
  }
}
