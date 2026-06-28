import { NextRequest, NextResponse } from 'next/server'
import { handleRouteError } from '@/lib/api-error'
import { getPredictionWithTags, findSimilarForecasts } from '@/lib/services/forecast'
import { aiFeaturesEnabled } from '@/lib/capabilities'

export const dynamic = 'force-dynamic'

// GET /api/forecasts/similar?id=<id>&limit=3
// GET /api/forecasts/similar?q=<text>&tags=<csv>&limit=3
export async function GET(request: NextRequest) {
  try {
    // Similar-forecasts relies on embeddings (an AI feature). When AI is off
    // (self-host default) return empty, matching the no-embeddings behavior.
    if (!aiFeaturesEnabled()) {
      return NextResponse.json({ similar: [] })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id') || undefined
    const q = (searchParams.get('q') || '').slice(0, 200)
    const tagsParam = searchParams.get('tags') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '3'), 10)

    let claimText = q
    let tags: string[] = tagsParam
      ? tagsParam.split(',').map(t => t.trim().slice(0, 50)).filter(Boolean).slice(0, 10)
      : []

    if (id) {
      const forecast = await getPredictionWithTags(id)
      if (!forecast) return NextResponse.json({ similar: [] })
      claimText = forecast.claimText
      tags = forecast.tags.map(t => t.name)
    }

    if (!claimText || claimText.length < 5) {
      return NextResponse.json({ similar: [] })
    }

    const similar = await findSimilarForecasts({ claimText, tags, excludeId: id, limit })
    return NextResponse.json({ similar })
  } catch (error) {
    return handleRouteError(error, 'Failed to find similar forecasts')
  }
}
