import { NextRequest, NextResponse } from 'next/server'
import { handleRouteError } from '@/lib/api-error'
import { type SortBy } from '@/lib/services/leaderboard'
import { getCachedLeaderboard } from '@/lib/services/leaderboard-cached'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'


// GET /api/leaderboard - Enhanced leaderboard with multiple sort modes
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`leaderboard:${clientIp(request)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const sortBy = (searchParams.get('sortBy') || 'elo') as SortBy
    const tagSlug = searchParams.get('tag') ?? undefined
    const leaderboard = await getCachedLeaderboard(limit, sortBy, tagSlug)
    return NextResponse.json({ leaderboard })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch leaderboard')
  }
}
