import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getEvidenceEstimateSeries, getForecastVisibility } from '@/lib/services/context'

/**
 * GET /api/forecasts/[id]/estimate-series — the forecast's estimate over time, evidence
 * snapshots only (daatan#2162; Oracul 1.5 Phase 2 item 2.2, umbrella #1644). Numbers only:
 * the timeline with sources stays on GET /api/forecasts/[id]/context.
 * Same visibility rule as GET /api/forecasts/[id]: a non-public forecast is a 404 unless
 * the caller is its author or an admin.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idOrSlug } = await params
    const forecast = await getForecastVisibility(idOrSlug)
    if (!forecast) return apiError('Prediction not found', 404)

    if (!forecast.isPublic) {
      let session = null
      try {
        session = await auth()
      } catch {
        // Ignore session errors: treated as anonymous.
      }
      const isAdmin = session?.user?.role === 'ADMIN'
      if (forecast.authorId !== session?.user?.id && !isAdmin) {
        return apiError('Prediction not found', 404)
      }
    }

    const points = await getEvidenceEstimateSeries(forecast.id)
    return NextResponse.json({ predictionId: forecast.id, points })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch estimate series')
  }
}
