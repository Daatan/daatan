import { NextRequest, NextResponse } from 'next/server'
import { handleRouteError } from '@/lib/api-error'
import { getRecentActivity } from '@/lib/services/commitment'


// GET /api/commitments/activity - Public real-time activity feed of recent commitments
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

    const activity = await getRecentActivity(limit)

    return NextResponse.json({ activity })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch activity feed')
  }
}
