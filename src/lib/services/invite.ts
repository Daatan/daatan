import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

/** SHA-256 hex of a raw token — deterministic, so the column stays look-up-able. */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface CreatedInvite {
  id: string
  /** The raw token — returned ONCE at creation; only its hash is stored. */
  rawToken: string
  createdAt: Date
}

/** Issue a new single-use invite. Returns the raw token for the invite URL. */
export async function createInvite(): Promise<CreatedInvite> {
  const rawToken = randomBytes(32).toString('base64url')
  const invite = await prisma.invite.create({
    data: { token: hashToken(rawToken) },
    select: { id: true, createdAt: true },
  })
  return { id: invite.id, rawToken, createdAt: invite.createdAt }
}

/**
 * Atomically consume an invite by its raw token. Returns true only if a
 * matching, not-yet-accepted invite existed — so two concurrent signups with
 * the same token can never both succeed (only one update wins).
 */
export async function consumeInvite(rawToken: string): Promise<boolean> {
  const { count } = await prisma.invite.updateMany({
    where: { token: hashToken(rawToken), acceptedAt: null },
    data: { acceptedAt: new Date() },
  })
  return count === 1
}

export interface InviteSummary {
  id: string
  createdAt: Date
  acceptedAt: Date | null
}

/** List invites, newest first, for the admin management view. Never exposes tokens. */
export async function listInvites(): Promise<InviteSummary[]> {
  return prisma.invite.findMany({
    select: { id: true, createdAt: true, acceptedAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

/** Revoke (delete) an invite by id. Returns false if it didn't exist. */
export async function revokeInvite(id: string): Promise<boolean> {
  const { count } = await prisma.invite.deleteMany({ where: { id } })
  return count === 1
}
