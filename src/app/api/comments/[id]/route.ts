import { NextResponse } from 'next/server'
import { updateCommentSchema } from '@/lib/validations/comment'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { findCommentById, updateComment, softDeleteComment } from '@/lib/services/comment'


// PATCH /api/comments/[id] - Update comment
export const PATCH = withAuth(async (request, user, { params }) => {
  const comment = await findCommentById(params.id)

  if (!comment || comment.deletedAt) {
    return apiError('Comment not found', 404, undefined, { notify: true, pathname: `/api/comments/${params.id}` })
  }

  if (comment.authorId !== user.id) {
    return apiError('Forbidden', 403)
  }

  const body = await request.json()
  const data = updateCommentSchema.parse(body)

  const updated = await updateComment(params.id, data.text)

  return NextResponse.json(updated)
})

// DELETE /api/comments/[id] - Soft delete comment
export const DELETE = withAuth(async (_request, user, { params }) => {
  const comment = await findCommentById(params.id)

  if (!comment || comment.deletedAt) {
    return apiError('Comment not found', 404, undefined, { notify: true, pathname: `/api/comments/${params.id}` })
  }

  const canDelete =
    comment.authorId === user.id ||
    user.role === 'ADMIN' ||
    user.role === 'RESOLVER'

  if (!canDelete) {
    return apiError('Forbidden', 403)
  }

  await softDeleteComment(params.id)

  return NextResponse.json({ success: true })
})
