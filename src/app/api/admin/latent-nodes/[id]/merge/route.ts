import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { mergeLatentNode } from '@/lib/services/latent-node'

export const dynamic = 'force-dynamic'

const schema = z.object({ targetId: z.string().min(1) })

export const POST = withAuth(
  async (request, user, { params }) => {
    try {
      const { targetId } = schema.parse(await request.json())
      const sourceId = params.id
      if (sourceId === targetId) return apiError('Cannot merge a latent node into itself', 400)
      const outcome = await mergeLatentNode(sourceId, targetId, user.id)
      return NextResponse.json(outcome)
    } catch (error) {
      return handleRouteError(error)
    }
  },
  { roles: ['ADMIN'] },
)
