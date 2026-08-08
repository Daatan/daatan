import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createPredictionSchema, listPredictionsQuerySchema } from '@/lib/validations/prediction'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { checkContent } from '@/lib/services/moderation'
import { translatePredictionToAllLocales } from '@/lib/services/translation'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { listForecasts, enrichPredictions, upsertNewsAnchor, verifyUserExists, createForecast } from '@/lib/services/forecast'
import { createLogger } from '@/lib/logger'
import { toError } from '@/lib/utils/error'
import { withRetry } from '@/lib/utils/retry'

const log = createLogger('api-forecasts')

export const dynamic = 'force-dynamic'

// GET /api/predictions - List predictions (public, with optional session for user context)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    let session = null
    try {
      session = await auth()
    } catch {
      // Treat as unauthenticated if session retrieval fails
    }
    const isAdminOrApprover = session?.user?.role === 'ADMIN' || session?.user?.role === 'APPROVER'

    const queryData = {
      status: searchParams.get('status') || undefined,
      authorId: searchParams.get('authorId') || undefined,
      tags: searchParams.get('tags') || undefined,
      q: searchParams.get('q') || undefined,
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 20,
      sortBy: searchParams.get('sortBy') || 'newest',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    }
    const result = listPredictionsQuerySchema.safeParse(queryData)
    if (!result.success) return handleRouteError(result.error)
    const query = result.data

    const resolvedOnly = searchParams.get('resolvedOnly') === 'true'
    const closingSoon = searchParams.get('closingSoon') === 'true'

    const where: Record<string, unknown> = {}
    // Sub-filters that must combine with AND but can't each own top-level `where.OR`
    // (the "Awaiting Resolution" status clause and the free-text search clause both
    // need their own OR — collected here and joined via where.AND at the end).
    const andConditions: Record<string, unknown>[] = []

    if (resolvedOnly) {
      where.status = { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE'] }
    } else if (query.status) {
      if (['DRAFT', 'PENDING_APPROVAL'].includes(query.status) && !isAdminOrApprover) {
        where.status = 'ACTIVE'
      } else if (query.status === 'PENDING') {
        // "Awaiting Resolution": deadline-passed forecasts (real PENDING) plus
        // still-ACTIVE forecasts the AI is confident about (>=90% or <=10%) —
        // see awaitingAiResolution in context.ts. Kept as a separate ACTIVE
        // forecast (not reusing PENDING for it) so staking stays open and the
        // news-indexer keeps re-evaluating it, letting the flag clear itself.
        andConditions.push({
          OR: [
            { status: 'PENDING' },
            { status: 'ACTIVE', awaitingAiResolution: true },
          ],
        })
      } else {
        where.status = query.status
      }
    }

    if (query.authorId) where.authorId = query.authorId

    if (query.tags) {
      const tagNames = query.tags.split(',').map(t => t.trim()).filter(Boolean)
      if (tagNames.length > 0) {
        where.tags = { some: { name: { in: tagNames } } }
      }
    }

    if (query.q) {
      andConditions.push({
        OR: [
          { claimText: { contains: query.q, mode: 'insensitive' } },
          { tags: { some: { name: { contains: query.q, mode: 'insensitive' } } } },
        ],
      })
    }

    if (andConditions.length > 0) where.AND = andConditions

    if (!query.authorId && !query.status && !resolvedOnly) {
      where.status = { notIn: ['DRAFT', 'PENDING_APPROVAL'] }
    }

    if (query.authorId) {
      const isOwnProfile = session?.user?.id === query.authorId
      const isAdmin = session?.user?.role === 'ADMIN'
      if (!isOwnProfile && !isAdmin) where.isPublic = true
    } else {
      where.isPublic = true
    }

    if (closingSoon && query.status === 'ACTIVE') {
      const sevenDaysFromNow = new Date()
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
      where.resolveByDatetime = { lte: sevenDaysFromNow, gte: new Date() }
    }

    const isCuSort = query.sortBy === 'cu'
    const orderBy: Record<string, 'asc' | 'desc'> = closingSoon || query.sortBy === 'deadline'
      ? { resolveByDatetime: query.sortOrder as 'asc' | 'desc' }
      : query.sortBy === 'updated'
        ? { updatedAt: query.sortOrder as 'asc' | 'desc' }
        : { createdAt: query.sortOrder as 'asc' | 'desc' }

    const { predictions, total } = await listForecasts({
      where, orderBy, page: query.page, limit: query.limit,
      isCuSort, sortOrder: query.sortOrder as 'asc' | 'desc',
      userId: session?.user?.id,
    })

    const finalPredictions = enrichPredictions(predictions, {
      page: query.page, limit: query.limit,
      sortOrder: query.sortOrder as 'asc' | 'desc', isCuSort,
    })

    return NextResponse.json({
      predictions: finalPredictions,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch predictions')
  }
}

// POST /api/predictions - Create a new prediction (draft)
export const POST = withAuth(async (request, user) => {
  // Each create triggers an LLM moderation call plus a background
  // translatePredictionToAllLocales sweep (one LLM call per locale) — throttle per
  // user like the app's other AI-cost routes.
  const rl = checkRateLimit(`forecasts-create:${user.id}`, 20, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const body = await request.json()
  const data = createPredictionSchema.parse(body)

  const userExists = await verifyUserExists(user.id)
  if (!userExists) {
    return apiError('User not found. Please sign out and sign back in.', 403)
  }

  if (new Date(data.resolveByDatetime) <= new Date()) {
    return apiError('Resolution date must be in the future', 400)
  }

  const moderationResult = await checkContent(`${data.claimText}\n\n${data.detailsText || ''}`, 'forecast')
  if (moderationResult.isOffensive) {
    const cleanReason = moderationResult.reason.replace('OFFENSIVE_INPUT:', '').trim()
    return apiError(`Moderation: ${cleanReason}`, 400)
  }

  let newsAnchorId = data.newsAnchorId
  if (!newsAnchorId && data.newsAnchorUrl) {
    const anchor = await upsertNewsAnchor(data.newsAnchorUrl, data.newsAnchorTitle)
    newsAnchorId = anchor.id
  }

  let outcomePayload: Record<string, unknown> = data.outcomePayload ?? {}
  if (data.outcomeType === 'BINARY' && Object.keys(outcomePayload).length === 0) {
    outcomePayload = { type: 'BINARY' }
  }

  try {
    const prediction = await createForecast({
      authorId: user.id,
      claimText: data.claimText,
      detailsText: data.detailsText,
      outcomeType: data.outcomeType,
      outcomePayload,
      resolutionRules: data.resolutionRules,
      resolveByDatetime: data.resolveByDatetime,
      isPublic: data.isPublic,
      source: data.source,
      confidence: data.confidence,
      newsAnchorId,
      tags: data.tags,
      externalMarketId: data.externalMarketId,
    })

    withRetry(() => translatePredictionToAllLocales(prediction!.id), {
      attempts: 3,
      onError: (err, attempt, attemptsLeft) =>
        log.warn({ err, predictionId: prediction!.id, attempt, attemptsLeft }, 'Background translation failed, retrying'),
    }).catch(err =>
      log.error({ err, predictionId: prediction!.id }, 'Background translation failed after all retries'),
    )

    return NextResponse.json(prediction, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unexpected error'
    if (msg.includes('unique URL slug')) return apiError(msg, 500)
    throw err
  }
})
