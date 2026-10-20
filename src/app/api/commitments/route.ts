import { NextRequest, NextResponse } from 'next/server'
import { listCommitmentsQuerySchema } from '@/lib/validations/prediction'
import { withAuth } from '@/lib/api-middleware'
import { listUserCommitments } from '@/lib/services/commitment'


// GET /api/commitments - List commitments for authenticated user
export const GET = withAuth(async (request, user) => {
  const searchParams = Object.fromEntries(request.nextUrl.searchParams)
  const query = listCommitmentsQuerySchema.parse(searchParams)

  const { page, limit, predictionId, status } = query

  const { commitments, total } = await listUserCommitments({
    userId: user.id,
    predictionId,
    status,
    page,
    limit,
  })

  const totalPages = Math.ceil(total / limit)

  return NextResponse.json({
    commitments,
    pagination: { page, limit, total, totalPages },
  })
})
