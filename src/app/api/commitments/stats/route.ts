import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { getCommitmentStats } from '@/lib/services/commitment'


// GET /api/commitments/stats - Get commitment stats for the current user
export const GET = withAuth(async (_request, user) => {
  const stats = await getCommitmentStats(user.id)
  return NextResponse.json(stats)
})
