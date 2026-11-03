import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, DELETE } from '../route'

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))

vi.mock('@/auth', () => ({
  auth: mockAuth,
}))

vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    prediction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    predictionOption: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    predictionTranslation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    commitment: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(mockPrisma)),
  }
  return { prisma: mockPrisma }
})

// ─── shared fixtures ──────────────────────────────────────────────────────────

const BASE_PREDICTION = {
  id: 'pred-1',
  slug: 'test-slug',
  shareToken: 'abc12345',
  isPublic: true,
  claimText: 'Test forecast',
  status: 'ACTIVE',
  authorId: 'user-1',
  author: { id: 'user-1', name: 'Alice', username: 'alice', image: null, rs: 100, role: 'USER' },
  newsAnchor: null,
  options: [],
  commitments: [],
  resolvedBy: null,
  _count: { commitments: 0 },
  totalCuCommitted: 0,
  resolveByDatetime: '2027-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  winnersPoolBonus: 0,
  lockedAt: null,
}

function makeRequest(method = 'GET', body?: object) {
  return new NextRequest(`http://localhost/api/forecasts/pred-1`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const routeCtx = (id = 'pred-1') => ({ params: Promise.resolve({ id }) })

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/forecasts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
  })

  it('returns 200 for a public forecast found by id', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(BASE_PREDICTION as any)

    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe('pred-1')
    expect(data.totalCuCommitted).toBe(0)
  })

  it('returns 404 when prediction does not exist', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(null)

    const res = await GET(makeRequest(), routeCtx())
    expect(res.status).toBe(404)
  })

  it('finds prediction by id or slug via findFirst', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(BASE_PREDICTION as any)

    await GET(
      new NextRequest('http://localhost/api/forecasts/test-slug'),
      routeCtx('test-slug')
    )

    const call = vi.mocked(prisma.prediction.findFirst).mock.calls[0][0] as any
    expect(call.where.OR).toEqual([
      { id: 'test-slug' },
      { slug: 'test-slug' }
    ])
  })

  describe('private forecast access gate', () => {
    const privatePrediction = { ...BASE_PREDICTION, isPublic: false }

    it('returns 404 for private forecast when accessed by non-author without token', async () => {
      const { prisma } = await import('@/lib/prisma')
      vi.mocked(prisma.prediction.findFirst).mockResolvedValue(privatePrediction as any)
      mockAuth.mockResolvedValue({ user: { id: 'other-user', role: 'USER' } })

      // Accessed via slug
      const res = await GET(
        new NextRequest('http://localhost/api/forecasts/test-slug'),
        routeCtx('test-slug')
      )
      expect(res.status).toBe(404)
    })

    it('returns 200 for private forecast when accessed by the author via slug', async () => {
      const { prisma } = await import('@/lib/prisma')
      vi.mocked(prisma.prediction.findFirst).mockResolvedValue(privatePrediction as any)
      mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } })

      const res = await GET(
        new NextRequest('http://localhost/api/forecasts/test-slug'),
        routeCtx('test-slug')
      )
      expect(res.status).toBe(200)
    })

    it('returns 200 for private forecast when accessed by admin', async () => {
      const { prisma } = await import('@/lib/prisma')
      vi.mocked(prisma.prediction.findFirst).mockResolvedValue(privatePrediction as any)
      mockAuth.mockResolvedValue({ user: { id: 'admin-user', role: 'ADMIN' } })

      const res = await GET(
        new NextRequest('http://localhost/api/forecasts/test-slug'),
        routeCtx('test-slug')
      )
      expect(res.status).toBe(200)
    })
  })
})

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /api/forecasts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'USER' },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const res = await PATCH(
      makeRequest('PATCH', { claimText: 'Updated' }),
      routeCtx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when prediction not found', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)

    const res = await PATCH(makeRequest('PATCH', { claimText: 'Updated' }), routeCtx())
    expect(res.status).toBe(404)
  })

  it('returns 403 when user is not the author', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'other-user',
      status: 'DRAFT',
      lockedAt: null,
    } as any)

    const res = await PATCH(makeRequest('PATCH', { claimText: 'Updated' }), routeCtx())
    expect(res.status).toBe(403)
  })

  it('returns 400 when trying to update non-draft field on a published forecast', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'ACTIVE',
      lockedAt: null,
    } as any)

    const res = await PATCH(makeRequest('PATCH', { claimText: 'Updated' }), routeCtx())
    expect(res.status).toBe(400)
  })

  it('allows isPublic toggle on a published forecast', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'ACTIVE',
      lockedAt: null,
    } as any)
    vi.mocked(prisma.prediction.update).mockResolvedValue({
      ...BASE_PREDICTION,
      isPublic: false,
    } as any)

    const res = await PATCH(makeRequest('PATCH', { isPublic: false }), routeCtx())
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.prediction.update).mock.calls[0][0] as any
    expect(updateCall.data.isPublic).toBe(false)
  })

  it('updates a draft forecast successfully', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'DRAFT',
      lockedAt: null,
    } as any)
    vi.mocked(prisma.prediction.update).mockResolvedValue({
      ...BASE_PREDICTION,
      claimText: 'Updated claim',
      status: 'DRAFT',
    } as any)

    const res = await PATCH(
      makeRequest('PATCH', { claimText: 'Updated claim' }),
      routeCtx()
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.claimText).toBe('Updated claim')
  })

  it('allows admin to update a non-draft forecast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } })
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'ACTIVE',
      lockedAt: null,
    } as any)
    vi.mocked(prisma.prediction.update).mockResolvedValue({
      ...BASE_PREDICTION,
      claimText: 'Admin edit',
    } as any)

    const res = await PATCH(makeRequest('PATCH', { claimText: 'Admin edit' }), routeCtx())
    expect(res.status).toBe(200)
  })

  it('allows updating options on a DRAFT forecast', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'DRAFT',
      lockedAt: null,
    } as any)

    const mockUpdate = vi.fn().mockResolvedValue({
      ...BASE_PREDICTION,
      options: [{ text: 'Option A' }, { text: 'Option B' }]
    })
    const mockDeleteOptions = vi.fn().mockResolvedValue({ count: 2 })
    const mockCreateOptions = vi.fn().mockResolvedValue({ count: 2 })

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) => {
      return callback({
        prediction: { update: mockUpdate },
        predictionOption: { deleteMany: mockDeleteOptions, createMany: mockCreateOptions },
      })
    })

    const res = await PATCH(
      makeRequest('PATCH', { options: ['Option A', 'Option B'] }),
      routeCtx()
    )
    expect(res.status).toBe(200)
    expect(mockDeleteOptions).toHaveBeenCalledWith({ where: { predictionId: 'pred-1' } })
    expect(mockCreateOptions).toHaveBeenCalled()
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/forecasts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'USER' },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const res = await DELETE(makeRequest('DELETE'), routeCtx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when prediction not found', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)

    const res = await DELETE(makeRequest('DELETE'), routeCtx())
    expect(res.status).toBe(404)
  })

  it('returns 403 when user is not the author', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'other-user',
      status: 'DRAFT',
    } as any)

    const res = await DELETE(makeRequest('DELETE'), routeCtx())
    expect(res.status).toBe(403)
  })

  it('returns 400 when trying to delete a non-draft', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'ACTIVE',
    } as any)

    const res = await DELETE(makeRequest('DELETE'), routeCtx())
    expect(res.status).toBe(400)
  })

  it('deletes a draft forecast and returns success', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      authorId: 'user-1',
      status: 'DRAFT',
    } as any)
    vi.mocked(prisma.prediction.delete).mockResolvedValue({} as any)

    const res = await DELETE(makeRequest('DELETE'), routeCtx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})
