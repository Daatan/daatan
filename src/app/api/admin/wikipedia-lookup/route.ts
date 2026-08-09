import { NextRequest, NextResponse } from 'next/server'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'

interface WikipediaSearchPage {
  key: string
  title: string
  description: string | null
}

interface WikipediaSearchResponse {
  pages: WikipediaSearchPage[]
}

export interface WikipediaLookupResult {
  title: string
  url: string
  description: string | null
}

export const GET = withAuth(async (request: NextRequest) => {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q) return apiError('Missing q param', 400)

  try {
    const resp = await fetch(
      `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=5`,
      { headers: { 'User-Agent': 'Daatan-Admin/1.0 (https://daatan.com)' } },
    )
    if (!resp.ok) return apiError('Wikipedia lookup failed', 502)

    const data = (await resp.json()) as WikipediaSearchResponse
    const results: WikipediaLookupResult[] = data.pages.map((p) => ({
      title: p.title,
      url: `https://en.wikipedia.org/wiki/${p.key}`,
      description: p.description,
    }))
    return NextResponse.json({ results })
  } catch (error) {
    return handleRouteError(error, 'Wikipedia lookup failed')
  }
}, { roles: ['ADMIN'] })
