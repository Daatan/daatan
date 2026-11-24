import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { apiError, handleRouteError } from '@/lib/api-error'
import { buildArticleDots } from '@/lib/article-dots'
import { isForecastViewableByVisitor } from '@/lib/forecast-visibility'
import { getArticleDotRows, getForecastVisibility } from '@/lib/services/context'

/**
 * GET /api/forecasts/[id]/article-dots — one dot per article in the Oracul's current pool for this forecast,
 * for the expanded "Probability over time" chart (daatan#2300). Fetched when that view opens,
 * never with the page. Same visibility rule as the forecast page (`isForecastViewableByVisitor`):
 * a private, draft or pending forecast is a 404 unless the caller is its author, an admin or an
 * approver — and the snapshot query never runs for a caller who can't see it.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params
    const forecast = await getForecastVisibility(idOrSlug)
    if (!forecast) return apiError('Prediction not found', 404)

    const subject = { isPublic: forecast.isPublic, status: forecast.status, author: { id: forecast.authorId } }
    if (!isForecastViewableByVisitor(subject, {})) {
      let session = null
      try {
        session = await auth()
      } catch {
        // Ignore session errors: treated as anonymous.
      }
      if (!isForecastViewableByVisitor(subject, { userId: session?.user?.id, role: session?.user?.role })) {
        return apiError('Prediction not found', 404)
      }
    }

    const rows = await getArticleDotRows(forecast.id)
    const poolSize = rows[0]?.poolSize ?? 0
    return NextResponse.json({
      predictionId: forecast.id,
      dots: buildArticleDots(rows),
      poolSize,
      truncated: poolSize > rows.length,
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch article dots')
  }
}
