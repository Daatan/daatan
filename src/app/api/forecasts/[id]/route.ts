import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { z } from 'zod'
import {
  getForecastById,
  getPredictionOwnershipInfo,
  getUserCommitment,
  updateForecast,
  deleteForecast,
  ForecastTranslationUnavailableError,
} from '@/lib/services/forecast'
import { getCachedPredictionTranslation } from '@/lib/services/translation'

export const dynamic = 'force-dynamic'

const patchPredictionSchema = z.object({
  claimText: z.string().min(5).max(500).optional(),
  detailsText: z.string().max(2000).optional().nullable(),
  resolutionRules: z.string().max(1000).optional().nullable(),
  resolveByDatetime: z.string().datetime().optional(),
  isPublic: z.boolean().optional(),
  options: z.array(z.string().min(1).max(500)).min(2).max(10).optional(),
})

// GET /api/forecasts/[id] - Get single forecast details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idOrSlug } = await params

    const prediction = await getForecastById(idOrSlug)

    if (!prediction) {
      return apiError('Prediction not found', 404, undefined, { notify: true, pathname: request.nextUrl.pathname })
    }

    // Get current user ID for personal commitment context
    let session = null
    try {
      session = await auth()
    } catch {
      // Ignore session errors
    }

    const userId = session?.user?.id
    const isAdmin = session?.user?.role === 'ADMIN'

    // Security: check visibility
    if (!prediction.isPublic && prediction.authorId !== userId && !isAdmin) {
      return apiError('Prediction not found', 404, undefined, { notify: true, pathname: request.nextUrl.pathname })
    }

    // Find user's specific commitment to this prediction if it exists
    let userCommitment = null
    if (userId) {
      userCommitment = await getUserCommitment(prediction.id, userId)
    }

    // Calculate total CU committed
    const totalCuCommitted = prediction.commitments.reduce((sum, c) => sum + c.cuCommitted, 0)

    // For non-English-authored forecasts, surface the author's original-language text so
    // the edit form can let them edit in their own language (claimText is English-canonical).
    const original =
      prediction.originalLanguage && prediction.originalLanguage !== 'en'
        ? await getCachedPredictionTranslation(prediction.id, prediction.originalLanguage)
        : undefined

    return NextResponse.json({
      ...prediction,
      totalCuCommitted,
      userCommitment,
      original,
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch prediction')
  }
}

// PATCH /api/forecasts/[id] - Update forecast (author only)
export const PATCH = withAuth(async (request, user, { params }) => {
  const { id } = params
  const body = await request.json()
  const data = patchPredictionSchema.parse(body)

  const prediction = await getPredictionOwnershipInfo(id)

  if (!prediction) {
    return apiError('Forecast not found', 404)
  }

  const isAdmin = user.role === 'ADMIN'
  const isOwner = prediction.authorId === user.id

  if (!isOwner && !isAdmin) {
    return apiError('Forbidden', 403)
  }

  const isPublished = ['ACTIVE', 'PENDING', 'PENDING_APPROVAL'].includes(prediction.status)
  const hasRestrictedChanges = data.claimText || data.detailsText || data.resolutionRules || data.resolveByDatetime || data.options

  if (isPublished && hasRestrictedChanges && !isAdmin) {
    return apiError(`Cannot edit core fields of a published forecast. Status: ${prediction.status}`, 400)
  }

  if (prediction.lockedAt && !isAdmin) {
    return apiError('Forecast is locked and cannot be edited', 400)
  }

  try {
    const updated = await updateForecast(id, data)
    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof ForecastTranslationUnavailableError) {
      return apiError('Translation service is temporarily unavailable. Please try again.', 503)
    }
    throw err
  }
})

// DELETE /api/forecasts/[id] - Delete forecast (DRAFT only, author or admin)
export const DELETE = withAuth(async (_request, user, { params }) => {
  const { id } = params

  const prediction = await getPredictionOwnershipInfo(id)

  if (!prediction) {
    return apiError('Forecast not found', 404)
  }

  const isAdmin = user.role === 'ADMIN'
  const isOwner = prediction.authorId === user.id

  if (!isOwner && !isAdmin) {
    return apiError('Forbidden', 403)
  }

  if (prediction.status !== 'DRAFT' && !isAdmin) {
    return apiError('Only draft forecasts can be deleted', 400)
  }

  await deleteForecast(id)

  return NextResponse.json({ success: true })
})
