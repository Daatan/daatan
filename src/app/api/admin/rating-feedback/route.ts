import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { getRatingFeedbackStats } from '@/lib/services/ratingFeedbackStats'

export const GET = withAuth(async () => {
  const stats = await getRatingFeedbackStats()
  return NextResponse.json(stats)
}, { roles: ['ADMIN'] })
