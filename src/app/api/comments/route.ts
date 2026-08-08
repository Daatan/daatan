import { NextRequest, NextResponse } from 'next/server'
import { createCommentSchema, listCommentsQuerySchema } from '@/lib/validations/comment'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { notifyNewComment } from '@/lib/services/telegram'
import { createNotification } from '@/lib/services/notification'
import { checkContent } from '@/lib/services/moderation'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  listComments,
  createComment,
  findCommentParent,
  findMentionedUsers,
} from '@/lib/services/comment'
import { getPredictionBasicInfo } from '@/lib/services/forecast'

export const dynamic = 'force-dynamic'

// GET /api/comments - List comments (public)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = listCommentsQuerySchema.parse({
      predictionId: searchParams.get('predictionId') || undefined,
      parentId: searchParams.get('parentId') || undefined,
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 50,
    })

    const { comments, total } = await listComments(query)

    return NextResponse.json({
      comments,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch comments')
  }
}

// POST /api/comments - Create a new comment
export const POST = withAuth(async (request, user) => {
  // Every comment triggers an LLM moderation call — throttle per user like the app's
  // other AI-cost routes (translate/suggest-tags/ai-extract).
  const rl = checkRateLimit(`comments:${user.id}`, 30, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const body = await request.json()
  const data = createCommentSchema.parse(body)

  const prediction = await getPredictionBasicInfo(data.predictionId)
  if (!prediction) return apiError('Prediction not found', 404)

  let parentComment: { id: string; authorId: string; deletedAt: Date | null } | null = null
  if (data.parentId) {
    parentComment = await findCommentParent(data.parentId)
    if (!parentComment || parentComment.deletedAt) return apiError('Parent comment not found', 404)
  }

  const moderationResult = await checkContent(data.text, 'comment')
  if (moderationResult.isOffensive) {
    const cleanReason = moderationResult.reason.replace('OFFENSIVE_INPUT:', '').trim()
    return apiError(`Moderation: ${cleanReason}`, 400)
  }

  const comment = await createComment({
    authorId: user.id,
    text: data.text,
    predictionId: data.predictionId,
    parentId: data.parentId,
  })

  const forecastLink = `/forecasts/${prediction.slug || prediction.id}`

  notifyNewComment(prediction, comment.author, data.text)

  createNotification({
    userId: prediction.authorId,
    type: 'COMMENT_ON_FORECAST',
    title: 'New comment on your forecast',
    message: `${comment.author.name || comment.author.username || 'Someone'} commented on "${prediction.claimText.substring(0, 80)}"`,
    link: forecastLink,
    predictionId: prediction.id,
    commentId: comment.id,
    actorId: user.id,
  })

  if (data.parentId && parentComment) {
    createNotification({
      userId: parentComment.authorId,
      type: 'REPLY_TO_COMMENT',
      title: 'New reply to your comment',
      message: `${comment.author.name || comment.author.username || 'Someone'} replied to your comment`,
      link: forecastLink,
      predictionId: prediction.id,
      commentId: comment.id,
      actorId: user.id,
    })
  }

  const mentionedUsernames = [...new Set(
    [...data.text.matchAll(/@([a-zA-Z0-9_]+)/g)].map((m) => m[1].toLowerCase()),
  )]
  if (mentionedUsernames.length > 0) {
    const alreadyNotifiedIds = new Set(
      [prediction.authorId, parentComment?.authorId, user.id].filter(Boolean),
    )
    const mentionedUsers = await findMentionedUsers(mentionedUsernames)
    for (const mentionedUser of mentionedUsers) {
      if (alreadyNotifiedIds.has(mentionedUser.id)) continue
      createNotification({
        userId: mentionedUser.id,
        type: 'MENTION',
        title: 'You were mentioned',
        message: `${comment.author.name || comment.author.username || 'Someone'} mentioned you in a comment on "${prediction.claimText.substring(0, 80)}"`,
        link: forecastLink,
        predictionId: prediction.id,
        commentId: comment.id,
        actorId: user.id,
      })
    }
  }

  return NextResponse.json(comment, { status: 201 })
})
