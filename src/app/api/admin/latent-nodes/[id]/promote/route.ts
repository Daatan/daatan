import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { promoteLatentNode, UnresolvableLatentNodeError } from '@/lib/services/latent-node'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (_request, user, { params }) => {
    try {
      const prediction = await promoteLatentNode(params.id, user.id)
      return NextResponse.json({ prediction })
    } catch (error) {
      if (error instanceof UnresolvableLatentNodeError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return handleRouteError(error)
    }
  },
  { roles: ['ADMIN'] },
)
