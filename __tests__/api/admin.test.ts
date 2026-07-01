import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── withAuth mock — injects a pre-made ADMIN user ───────────────────────────
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (handler: (req: Request, user: unknown, ctx: unknown) => unknown, _opts?: unknown) =>
    async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
      const params = await ctx.params
      return handler(req, { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN', rs: 0 }, { ...ctx, params })
    },
}))

// ─── Prisma mock ─────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CTX = { params: Promise.resolve({}) }
const CTX_WITH_ID = (id: string) => ({ params: Promise.resolve({ id }) })

function makeRequest(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/forecasts
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/forecasts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns paginated predictions', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/forecasts/route')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([
      { id: 'p1', claimText: 'Will X happen?', author: { name: 'Alice', email: 'a@e.com' }, _count: { commitments: 3, comments: 1 } },
    ] as any)
    vi.mocked(prisma.prediction.count).mockResolvedValue(1)

    const res = await GET(makeRequest('http://localhost/api/admin/forecasts'), CTX)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.predictions).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(data.pages).toBe(1)
  })

  it('passes search filter to Prisma', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/forecasts/route')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.prediction.count).mockResolvedValue(0)

    await GET(makeRequest('http://localhost/api/admin/forecasts?search=bitcoin'), CTX)

    const where = vi.mocked(prisma.prediction.findMany).mock.calls[0][0]?.where
    expect(where).toHaveProperty('OR')
  })

  it('caps limit at 100', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/forecasts/route')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.prediction.count).mockResolvedValue(0)

    await GET(makeRequest('http://localhost/api/admin/forecasts?limit=9999'), CTX)

    const take = vi.mocked(prisma.prediction.findMany).mock.calls[0][0]?.take
    expect(take).toBe(100)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/forecasts/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/forecasts/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates prediction status', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { PATCH } = await import('@/app/api/admin/forecasts/[id]/route')

    vi.mocked(prisma.prediction.update).mockResolvedValue({ id: 'p1', status: 'ACTIVE' } as any)

    const res = await PATCH(makeRequest('http://localhost/api/admin/forecasts/p1', 'PATCH', { status: 'ACTIVE' }), CTX_WITH_ID('p1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe('ACTIVE')
    expect(prisma.prediction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: { status: 'ACTIVE' },
    }))
  })

  it('returns 400 for invalid status', async () => {
    const { PATCH } = await import('@/app/api/admin/forecasts/[id]/route')

    const res = await PATCH(makeRequest('http://localhost/api/admin/forecasts/p1', 'PATCH', { status: 'INVALID' }), CTX_WITH_ID('p1'))
    expect(res.status).toBe(400)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/forecasts/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/admin/forecasts/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the prediction and returns success', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { DELETE } = await import('@/app/api/admin/forecasts/[id]/route')

    vi.mocked(prisma.prediction.delete).mockResolvedValue({ id: 'p1' } as any)

    const res = await DELETE(makeRequest('http://localhost/api/admin/forecasts/p1', 'DELETE'), CTX_WITH_ID('p1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(prisma.prediction.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('returns 404 (not 500) when the prediction is already gone', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { DELETE } = await import('@/app/api/admin/forecasts/[id]/route')

    vi.mocked(prisma.prediction.delete).mockRejectedValue({ code: 'P2025' } as any)

    const res = await DELETE(makeRequest('http://localhost/api/admin/forecasts/gone', 'DELETE'), CTX_WITH_ID('gone'))
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toBe('Not found')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/users', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns paginated users', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/users/route')

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'u1', name: 'Alice', email: 'a@e.com', role: 'USER', rs: 1.0, createdAt: new Date(), _count: { predictions: 2, commitments: 5 } },
    ] as any)
    vi.mocked(prisma.user.count).mockResolvedValue(1)

    const res = await GET(makeRequest('http://localhost/api/admin/users'), CTX)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.users).toHaveLength(1)
    expect(data.total).toBe(1)
  })

  it('searches by name, email, and username', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/users/route')

    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.count).mockResolvedValue(0)

    await GET(makeRequest('http://localhost/api/admin/users?search=alice'), CTX)

    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where
    expect(where).toHaveProperty('OR')
    const orClauses = (where as any).OR
    expect(orClauses.some((c: any) => c.name)).toBe(true)
    expect(orClauses.some((c: any) => c.email)).toBe(true)
    expect(orClauses.some((c: any) => c.username)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/users/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/users/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates user role', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { PATCH } = await import('@/app/api/admin/users/[id]/route')

    vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u2', role: 'RESOLVER' } as any)

    const res = await PATCH(makeRequest('http://localhost/api/admin/users/u2', 'PATCH', { role: 'RESOLVER' }), CTX_WITH_ID('u2'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.role).toBe('RESOLVER')
  })

  it('prevents self-demotion', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/route')

    // The mock injects user id = 'admin-1'; targeting the same id
    const res = await PATCH(makeRequest('http://localhost/api/admin/users/admin-1', 'PATCH', { role: 'USER' }), CTX_WITH_ID('admin-1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid role', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/route')

    const res = await PATCH(makeRequest('http://localhost/api/admin/users/u2', 'PATCH', { role: 'SUPERADMIN' }), CTX_WITH_ID('u2'))
    expect(res.status).toBe(400)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/comments
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/comments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns paginated comments', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/comments/route')

    vi.mocked(prisma.comment.findMany).mockResolvedValue([
      { id: 'cm1', text: 'Nice forecast', author: { name: 'Bob', email: 'b@e.com' }, prediction: { claimText: 'Will X?' } },
    ] as any)
    vi.mocked(prisma.comment.count).mockResolvedValue(1)

    const res = await GET(makeRequest('http://localhost/api/admin/comments'), CTX)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.comments).toHaveLength(1)
    expect(data.total).toBe(1)
  })

  it('passes search to Prisma', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { GET } = await import('@/app/api/admin/comments/route')

    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.comment.count).mockResolvedValue(0)

    await GET(makeRequest('http://localhost/api/admin/comments?search=spam'), CTX)

    const where = vi.mocked(prisma.comment.findMany).mock.calls[0][0]?.where
    expect(where).toHaveProperty('OR')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/comments/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/admin/comments/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('soft-deletes the comment', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { DELETE } = await import('@/app/api/admin/comments/[id]/route')

    vi.mocked(prisma.comment.update).mockResolvedValue({ id: 'cm1', deletedAt: new Date() } as any)

    const res = await DELETE(makeRequest('http://localhost/api/admin/comments/cm1', 'DELETE'), CTX_WITH_ID('cm1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(prisma.comment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cm1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }))
  })
})
