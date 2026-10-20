import { NextRequest, NextResponse } from 'next/server'
import { createNewsAnchorSchema } from '@/lib/validations/prediction'
import { handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { searchNewsAnchors, getOrCreateNewsAnchor } from '@/lib/services/news-anchor'


// GET /api/news-anchors - Search/list news anchors (public)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const url = searchParams.get('url') || undefined
    const search = searchParams.get('search') || undefined
    const limit = parseInt(searchParams.get('limit') || '20')

    const anchors = await searchNewsAnchors({ url, search, limit })

    return NextResponse.json({ anchors })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch news anchors')
  }
}

// POST /api/news-anchors - Create or get existing news anchor
export const POST = withAuth(async (request) => {
  const body = await request.json()
  const data = createNewsAnchorSchema.parse(body)

  const result = await getOrCreateNewsAnchor({
    url: data.url,
    title: data.title,
    source: data.source,
    publishedAt: data.publishedAt,
    snippet: data.snippet,
    imageUrl: data.imageUrl,
  })

  return NextResponse.json(result, { status: result.isExisting ? 200 : 201 })
})
