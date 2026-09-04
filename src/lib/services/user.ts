import { prisma } from '@/lib/prisma'

export interface UpdateProfileData {
  name?: string | null
  username?: string | null
  website?: string | null
  twitterHandle?: string | null
  emailNotifications?: boolean
}

export const updateProfile = async (userId: string, data: UpdateProfileData) => {
  if (data.username) {
    const existing = await prisma.user.findUnique({ where: { username: data.username } })
    if (existing && existing.id !== userId) {
      return { ok: false as const, error: 'Username already taken', status: 400 }
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      name: data.name ?? null,
      username: data.username ?? null,
      website: data.website ?? null,
      twitterHandle: data.twitterHandle ?? null,
      emailNotifications: data.emailNotifications,
    },
    select: {
      id: true,
      name: true,
      username: true,
      website: true,
      twitterHandle: true,
      emailNotifications: true,
    },
  })

  return { ok: true as const, data: updated, status: 200 }
}

export const updateAvatar = async (userId: string, avatarUrl: string) => {
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl } })
}

export const updateLanguage = async (userId: string, language: string) => {
  await prisma.user.update({ where: { id: userId }, data: { preferredLanguage: language } })
}

export const deleteAccount = async (userId: string) => {
  await prisma.user.delete({ where: { id: userId } })
}

// Terminal prediction statuses — anything else (including PENDING_APPROVAL, which
// already accepts the author's own stake) could still resolve later, so
// forgetHistory() must refuse while a commitment sits on a non-terminal prediction:
// detaching now would sever a commitment that later resolves and can no longer
// notify or attribute back to this user.
const TERMINAL_PREDICTION_STATUSES = ['RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE'] as const

/**
 * "Forget History" (daatan#1701): detach a user from their own already-resolved
 * commitments (userId -> null) and reset their derived scoring fields to schema
 * defaults. The commitment rows, and every other user's scoring that was computed
 * against them, are left untouched — only this user's link to their own history
 * is severed.
 */
export const forgetHistory = async (userId: string) => {
  const openCount = await prisma.commitment.count({
    where: { userId, prediction: { status: { notIn: [...TERMINAL_PREDICTION_STATUSES] } } },
  })
  if (openCount > 0) {
    return {
      ok: false as const,
      error: 'Cannot forget history while you have commitments on active or pending forecasts',
      status: 400,
    }
  }

  await prisma.$transaction([
    prisma.commitment.updateMany({
      where: { userId },
      data: { userId: null },
    }),
    prisma.userTagRating.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        rs: 100,
        mu: 1500,
        sigma: 350,
        volatility: 0.06,
        eloRating: 1500,
        totalPredictions: 0,
        correctPredictions: 0,
      },
    }),
  ])

  return { ok: true as const, status: 200 }
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } })
}

export async function findUserBasicInfo(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { name: true, username: true } })
}

export async function findUsernameCollisions(baseUsername: string, baseSlug: string) {
  return prisma.user.findMany({
    where: {
      OR: [
        { username: { startsWith: baseUsername } },
        { slug: { startsWith: baseSlug } },
      ],
    },
    select: { username: true, slug: true },
  })
}

export interface RegisterUserData {
  name: string
  email: string
  hashedPassword: string
  username: string
  slug: string
}

export async function registerUser(data: RegisterUserData) {
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: data.hashedPassword,
      username: data.username,
      slug: data.slug,
    },
  })
}

export interface AdminUsersQuery {
  search?: string
  page: number
  limit: number
}

export async function listAdminUsers({ search, page, limit }: AdminUsersQuery) {
  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, username: true, email: true, role: true,
        rs: true, createdAt: true, isBot: true,
        _count: { select: { predictions: true, commitments: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ])

  return { users, total, pages: Math.ceil(total / limit) }
}

export async function updateUserRole(id: string, role: string) {
  return prisma.user.update({
    where: { id },
    data: { role: role as 'USER' | 'RESOLVER' | 'APPROVER' | 'ADMIN' },
    select: {
      id: true, name: true, username: true, emailNotifications: true,
      isPublic: true, role: true, rs: true, isBot: true,
    },
  })
}
