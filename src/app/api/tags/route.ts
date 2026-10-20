import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { listTags, createTag } from '@/lib/services/tag'


// GET /api/tags - List all tags with usage counts
export async function GET() {
  try {
    const tags = await listTags()
    return NextResponse.json({ tags })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch tags')
  }
}

const createTagSchema = z.object({
  name: z.string()
    .min(1, 'Tag name is required')
    .max(50, 'Tag name must be 50 characters or less')
    .transform(s => s.trim()),
})

// POST /api/tags - Create a new tag (admin only)
export const POST = withAuth(async (request, user) => {
  if (user.role !== 'ADMIN') {
    return apiError('Forbidden: Only admins can create tags', 403)
  }

  try {
    const body = await request.json()
    const result = createTagSchema.safeParse(body)
    if (!result.success) return apiError(result.error.issues[0].message, 400)

    const res = await createTag(result.data.name)
    if (!res.ok) return apiError(res.error, res.status)
    return NextResponse.json(res.data, { status: 201 })
  } catch (error) {
    return handleRouteError(error, 'Failed to create tag')
  }
})
