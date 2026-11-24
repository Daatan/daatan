import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockCreateNotification } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    predictionCreator: { findUnique: vi.fn() },
  },
  mockCreateNotification: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/services/notification', () => ({ createNotification: mockCreateNotification }))

import { getOrCreateDaatanUser, getRealCreator, notifyForecastOwner } from '../daatan-author'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('daatan-author (#2301)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reuses the existing Daatan account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'daatan-user' })
    expect(await getOrCreateDaatanUser()).toEqual({ id: 'daatan-user' })
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('creates it as a public, bot-flagged account that gets no email and has no bot config', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    mockPrisma.user.create.mockResolvedValue({ id: 'new-daatan' })

    expect(await getOrCreateDaatanUser()).toEqual({ id: 'new-daatan' })
    const data = mockPrisma.user.create.mock.calls[0][0].data
    expect(data).toMatchObject({ name: 'Daatan', username: 'daatan', isBot: true, isPublic: true, emailNotifications: false })
    expect(data.image).toMatch(/^https?:\/\/.+\/logo-icon-192\.png$/)
    expect(data).not.toHaveProperty('botConfig')
  })

  it('returns the real creator only when one is recorded', async () => {
    mockPrisma.predictionCreator.findUnique.mockResolvedValueOnce({ user: { id: 'admin1', name: 'Admin', username: 'adm' } })
    expect(await getRealCreator('p1')).toEqual({ id: 'admin1', name: 'Admin', username: 'adm' })
    mockPrisma.predictionCreator.findUnique.mockResolvedValueOnce(null)
    expect(await getRealCreator('p2')).toBeNull()
  })

  it('sends an author notification to the real creator of a Daatan forecast', async () => {
    mockPrisma.predictionCreator.findUnique.mockResolvedValue({ userId: 'admin1' })
    notifyForecastOwner({ id: 'p1', authorId: 'daatan-user' }, { type: 'NEW_COMMITMENT', title: 't', message: 'm' })
    await flush()
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin1', type: 'NEW_COMMITMENT' }))
  })

  it('sends it to the author of any other forecast', async () => {
    mockPrisma.predictionCreator.findUnique.mockResolvedValue(null)
    notifyForecastOwner({ id: 'p2', authorId: 'user1' }, { type: 'COMMENT_ON_FORECAST', title: 't', message: 'm' })
    await flush()
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user1' }))
  })
})
