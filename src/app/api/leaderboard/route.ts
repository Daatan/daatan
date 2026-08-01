import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { handleRouteError } from '@/lib/api-error'
import { getLeaderboard, type SortBy } from '@/lib/services/leaderboard'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Rankings move slowly (only on resolution events) — 5min TTL matches the
// leaderboard/layout.tsx JSON-LD cache. unstable_cache keys on the
// serialized arguments in addition to keyParts, so each distinct
// (limit, sortBy, tagSlug) combination gets its own cache entry.
const getCachedLeaderboard = unstable_cache(
  async (limit: number, sortBy: SortBy, tagSlug?: string) => getLeaderboard(limit, sortBy, tagSlug),
  ['leaderboard-api'],
  { revalidate: 300, tags: ['leaderboard'] },
)

// GET /api/leaderboard - Enhanced leaderboard with multiple sort modes
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`leaderboard:${clientIp(request)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const sortBy = (searchParams.get('sortBy') || 'rs') as SortBy
    const tagSlug = searchParams.get('tag') ?? undefined
    const leaderboard = await getCachedLeaderboard(limit, sortBy, tagSlug)
    return NextResponse.json({ leaderboard })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch leaderboard')
  }
}
