import { NextRequest, NextResponse } from 'next/server'
import { apiError, handleRouteError } from '@/lib/api-error'
import { translatePrediction, getCachedPredictionTranslation, DISPLAY_TRANSLATED_FIELDS } from '@/lib/services/translation'
import { parseJsonBody } from '@/lib/api-body'
import { translateBodySchema } from '@/lib/validations/api-inputs'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'


const TRANSLATE_LIMIT = 20
const TRANSLATE_WINDOW = 60 * 60_000 // 1 hour

// POST /api/forecasts/[id]/translate
// Body: { language: string }
// Returns translated fields for the prediction
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { language } = await parseJsonBody(request, translateBodySchema)

    // Check prediction + cache in parallel; return immediately if fully cached.
    // This avoids burning rate-limit quota on cache hits.
    const [prediction, cached] = await Promise.all([
      prisma.prediction.findUnique({
        where: { id },
        select: { claimText: true, detailsText: true, resolutionRules: true, headline: true },
      }),
      getCachedPredictionTranslation(id, language),
    ])

    if (!prediction) return apiError('Prediction not found', 404)

    const needed = DISPLAY_TRANSLATED_FIELDS.filter((f) => !!prediction[f])
    if (needed.length > 0 && needed.every((f) => f in cached)) {
      return NextResponse.json(cached)
    }

    // Cache incomplete — gate on rate limit before calling Gemini
    const rl = checkRateLimit(`translate:${clientIp(request)}`, TRANSLATE_LIMIT, TRANSLATE_WINDOW)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)

    const translations = await translatePrediction(id, language)
    return NextResponse.json(translations)
  } catch (err) {
    return handleRouteError(err, 'translate prediction')
  }
}
