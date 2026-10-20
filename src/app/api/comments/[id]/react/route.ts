import { NextResponse } from 'next/server'
import { addReactionSchema } from '@/lib/validations/comment'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { findCommentById, upsertCommentReaction, deleteCommentReaction } from '@/lib/services/comment'


// POST /api/comments/[id]/react - Add or update reaction
export const POST = withAuth(async (request, user, { params }) => {
  const comment = await findCommentById(params.id)

  if (!comment || comment.deletedAt) {
    return apiError('Comment not found', 404)
  }

  const body = await request.json()
  const data = addReactionSchema.parse(body)

  const reaction = await upsertCommentReaction(params.id, user.id, data.type)

  return NextResponse.json(reaction)
})

// DELETE /api/comments/[id]/react - Remove reaction
export const DELETE = withAuth(async (_request, user, { params }) => {
  await deleteCommentReaction(params.id, user.id)

  return NextResponse.json({ success: true })
})
