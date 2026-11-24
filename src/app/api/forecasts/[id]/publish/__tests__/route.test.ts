import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockAuth, mockGetForecastById, mockPublishForecast, mockGetRealCreatorId } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetForecastById: vi.fn(),
  mockPublishForecast: vi.fn(),
  mockGetRealCreatorId: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/services/forecast', () => ({
  getForecastById: mockGetForecastById,
  publishForecast: mockPublishForecast,
}))
vi.mock('@/lib/services/telegram', () => ({ notifyForecastPublished: vi.fn() }))
vi.mock('@/lib/services/daatan-author', () => ({ getRealCreatorId: mockGetRealCreatorId }))

import { POST } from '../route'

const draft = (authorId: string) => ({
  id: 'p1',
  authorId,
  status: 'DRAFT',
  claimText: 'Will the thing happen by the deadline?',
  resolutionRules: 'Resolves YES if the thing happens as described.',
  resolveByDatetime: new Date('2099-01-01'),
  outcomeType: 'BINARY',
  options: [],
})

const publish = () => POST(new NextRequest('http://localhost/api/forecasts/p1/publish', { method: 'POST' }), {
  params: Promise.resolve({ id: 'p1' }),
} as never)

describe('POST /api/forecasts/[id]/publish — forecasts published as Daatan (#2301)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublishForecast.mockResolvedValue({ id: 'p1', author: { id: 'daatan-user' } })
  })

  it('lets an admin publish a Daatan draft', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN' } })
    mockGetForecastById.mockResolvedValue(draft('daatan-user'))
    mockGetRealCreatorId.mockResolvedValue('admin1')

    expect((await publish()).status).toBe(200)
    expect(mockPublishForecast).toHaveBeenCalledWith('p1')
  })

  it("still refuses an admin publishing another user's draft", async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN' } })
    mockGetForecastById.mockResolvedValue(draft('user2'))
    mockGetRealCreatorId.mockResolvedValue(null)

    expect((await publish()).status).toBe(403)
    expect(mockPublishForecast).not.toHaveBeenCalled()
  })

  it('refuses a non-admin publishing a Daatan draft', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1', role: 'USER' } })
    mockGetForecastById.mockResolvedValue(draft('daatan-user'))
    mockGetRealCreatorId.mockResolvedValue('admin1')

    expect((await publish()).status).toBe(403)
    expect(mockPublishForecast).not.toHaveBeenCalled()
  })

  it('lets the author publish their own draft without a creator lookup', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1', role: 'USER' } })
    mockGetForecastById.mockResolvedValue(draft('user1'))

    expect((await publish()).status).toBe(200)
    expect(mockGetRealCreatorId).not.toHaveBeenCalled()
  })
})
