import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { isReservedUsername } from '@/lib/daatan-account'
import { updateProfile } from '../user'
import { getTopReputation } from '../leaderboard'

describe('the Daatan account (#2301)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reserves its username in any case', () => {
    expect(isReservedUsername('daatan')).toBe(true)
    expect(isReservedUsername('DaAtan')).toBe(true)
    expect(isReservedUsername('daatan1')).toBe(false)
  })

  it('cannot be claimed through the profile form', async () => {
    const result = await updateProfile('u1', { username: 'Daatan', emailNotifications: true })
    expect(result.ok).toBe(false)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('is kept off the reputation board without dropping users that have no username', async () => {
    mockPrisma.user.findMany.mockResolvedValue([])
    await getTopReputation(10)
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({
      isPublic: true,
      OR: [{ username: null }, { username: { not: 'daatan' } }],
    })
  })
})
