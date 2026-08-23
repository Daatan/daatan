import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { createLatentNode, listLatentNodes } from '@/lib/services/latent-node'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  textEn: z.string().min(5).max(500),
  claimDeadline: z.string().datetime().nullable().optional(),
  claimDirection: z.enum(['ARRIVAL', 'SURVIVAL', 'NONE']).nullable().optional(),
  claimArchetype: z.enum(['DIFFUSE', 'SCHEDULED', 'THRESHOLD', 'NONE']).nullable().optional(),
  origin: z.enum(['ARTICLE_ANTECEDENT', 'VARIANT', 'MCP_PROBE', 'EXPRESS']),
})

/**
 * Minimal admin create — a stand-in until the linking pipeline (v2 steps 2–4)
 * exists to populate this table from article extraction. Exists so merge has
 * real rows to operate on.
 */
export const POST = withAuth(
  async (request, user) => {
    try {
      const body = createSchema.parse(await request.json())
      const node = await createLatentNode({
        textEn: body.textEn,
        claimDeadline: body.claimDeadline ? new Date(body.claimDeadline) : null,
        claimDirection: body.claimDirection ?? null,
        claimArchetype: body.claimArchetype ?? null,
        origin: body.origin,
        createdBy: user.id,
      })
      return NextResponse.json(node, { status: 201 })
    } catch (error) {
      return handleRouteError(error)
    }
  },
  { roles: ['ADMIN'] },
)

const listSchema = z.object({
  status: z.enum(['OPEN', 'MERGED', 'PROMOTED', 'REJECTED']).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const GET = withAuth(
  async (request) => {
    try {
      const { status, limit } = listSchema.parse({
        status: request.nextUrl.searchParams.get('status'),
        limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      })
      const nodes = await listLatentNodes({ status: status ?? undefined, limit })
      return NextResponse.json({ nodes })
    } catch (error) {
      return handleRouteError(error)
    }
  },
  { roles: ['ADMIN'] },
)
