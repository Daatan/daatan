import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invite: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

describe('invite service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createInvite stores only the SHA-256 hash and returns the raw token once', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.invite.create).mockResolvedValue({ id: 'inv1', createdAt: new Date() } as never)
    const { createInvite } = await import('@/lib/services/invite')

    const result = await createInvite()

    expect(result.rawToken).toBeTruthy()
    const createArg = vi.mocked(prisma.invite.create).mock.calls[0][0]
    // stored token is the hash of the raw token, not the raw token itself
    expect(createArg.data.token).toBe(sha256(result.rawToken))
    expect(createArg.data.token).not.toBe(result.rawToken)
  })

  it('consumeInvite atomically matches the hash and an unaccepted invite', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.invite.updateMany).mockResolvedValue({ count: 1 } as never)
    const { consumeInvite } = await import('@/lib/services/invite')

    const ok = await consumeInvite('raw-token')

    expect(ok).toBe(true)
    const where = vi.mocked(prisma.invite.updateMany).mock.calls[0][0].where
    expect(where).toMatchObject({ token: sha256('raw-token'), acceptedAt: null })
  })

  it('consumeInvite returns false when no row was updated (unknown/used token)', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.invite.updateMany).mockResolvedValue({ count: 0 } as never)
    const { consumeInvite } = await import('@/lib/services/invite')

    expect(await consumeInvite('nope')).toBe(false)
  })

  it('listInvites never selects the token column', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.invite.findMany).mockResolvedValue([] as never)
    const { listInvites } = await import('@/lib/services/invite')

    await listInvites()
    const select = vi.mocked(prisma.invite.findMany).mock.calls[0][0]!.select
    expect(select).not.toHaveProperty('token')
    expect(select).toMatchObject({ id: true, createdAt: true, acceptedAt: true })
  })

  it('revokeInvite reports whether a row was deleted', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { revokeInvite } = await import('@/lib/services/invite')

    vi.mocked(prisma.invite.deleteMany).mockResolvedValue({ count: 1 } as never)
    expect(await revokeInvite('inv1')).toBe(true)

    vi.mocked(prisma.invite.deleteMany).mockResolvedValue({ count: 0 } as never)
    expect(await revokeInvite('missing')).toBe(false)
  })
})
