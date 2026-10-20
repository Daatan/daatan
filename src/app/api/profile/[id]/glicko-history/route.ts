import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getGlickoHistory } from '@/lib/services/expertise'
import { apiError, handleRouteError } from '@/lib/api-error'


type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const tag = request.nextUrl.searchParams.get('tag') ?? undefined

    const user = await prisma.user.findFirst({
      where: { OR: [{ id }, { username: id }] },
      select: { id: true },
    })

    if (!user) return apiError('User not found', 404)

    const points = await getGlickoHistory(user.id, tag)

    return NextResponse.json({ points })
  } catch (err) {
    return handleRouteError(err, 'Failed to fetch Glicko history')
  }
}
