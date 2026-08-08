import { prisma } from '@/lib/prisma'
import { ReactionType } from '@prisma/client'

const COMMENT_AUTHOR_SELECT = {
  id: true,
  name: true,
  username: true,
  image: true,
  rs: true,
  role: true,
} as const

const COMMENT_INCLUDE = {
  author: { select: COMMENT_AUTHOR_SELECT },
  reactions: {
    include: {
      user: { select: { id: true, name: true, username: true } },
    },
  },
  _count: { select: { replies: true } },
} as const

export interface ListCommentsQuery {
  predictionId?: string
  parentId?: string
  page: number
  limit: number
}

export async function listComments(query: ListCommentsQuery) {
  const where: Record<string, unknown> = { deletedAt: null }
  if (query.predictionId) where.predictionId = query.predictionId
  where.parentId = query.parentId ?? null

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.comment.count({ where }),
  ])

  return { comments, total }
}

export interface CreateCommentInput {
  authorId: string
  text: string
  predictionId: string
  parentId?: string
  /** daatan#1318: checkContent() threw instead of returning a verdict — flag for manual review. */
  moderationCheckFailed?: boolean
}

export async function findCommentParent(parentId: string) {
  return prisma.comment.findUnique({
    where: { id: parentId },
    select: { id: true, authorId: true, deletedAt: true },
  })
}

export async function createComment(input: CreateCommentInput) {
  return prisma.comment.create({
    data: {
      authorId: input.authorId,
      text: input.text,
      predictionId: input.predictionId,
      parentId: input.parentId,
      moderationCheckFailed: input.moderationCheckFailed ?? false,
    },
    include: COMMENT_INCLUDE,
  })
}

export async function findCommentById(id: string) {
  return prisma.comment.findUnique({ where: { id } })
}

export async function findMentionedUsers(usernames: string[]) {
  return prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true, username: true },
  })
}

export async function updateComment(id: string, text: string) {
  await prisma.commentTranslation.deleteMany({ where: { commentId: id } })
  return prisma.comment.update({
    where: { id },
    data: { text, updatedAt: new Date() },
    include: {
      author: { select: { id: true, name: true, username: true, image: true, rs: true } },
      reactions: true,
      _count: { select: { replies: true } },
    },
  })
}

export async function softDeleteComment(id: string) {
  return prisma.comment.update({
    where: { id },
    data: { deletedAt: new Date() },
  })
}

export async function upsertCommentReaction(commentId: string, userId: string, type: ReactionType) {
  return prisma.commentReaction.upsert({
    where: { userId_commentId: { userId, commentId } },
    update: { type },
    create: { userId, commentId, type },
    include: { user: { select: { id: true, name: true, username: true } } },
  })
}

export async function deleteCommentReaction(commentId: string, userId: string) {
  return prisma.commentReaction.deleteMany({ where: { userId, commentId } })
}

export interface AdminCommentsQuery {
  search?: string
  page: number
  limit: number
}

export async function listAdminComments({ search, page, limit }: AdminCommentsQuery) {
  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { text: { contains: search, mode: 'insensitive' } },
      { author: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      include: {
        author: { select: { name: true, email: true } },
        prediction: { select: { claimText: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.comment.count({ where }),
  ])

  return { comments, total, pages: Math.ceil(total / limit) }
}
