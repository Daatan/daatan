import { NextRequest, NextResponse } from 'next/server'
import { handleRouteError } from '@/lib/api-error'
import { type SourceLeaderboardView, type SourceSortBy } from '@/lib/services/sourceLeaderboard'
import { getCachedSourceLeaderboard } from '@/lib/services/leaderboard-cached'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'


// GET /api/leaderboard/sources - author/outlet shadow-scoring leaderboard
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`leaderboard-sources:${clientIp(request)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  try {
    const { searchParams } = new URL(request.url)
    const view: SourceLeaderboardView = searchParams.get('view') === 'outlets' ? 'outlets' : 'authors'
    const sortBy: SourceSortBy = searchParams.get('sortBy') === 'brierScore' ? 'brierScore' : 'skillConservative'
    const tag = searchParams.get('tag')?.slice(0, 80) || null
    const leaderboard = await getCachedSourceLeaderboard(view, sortBy, tag)
    return NextResponse.json(leaderboard)
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch source leaderboard')
  }
}
