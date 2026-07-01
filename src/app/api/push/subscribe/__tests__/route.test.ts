/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Auth middleware — inject a pre-made user, skip session lookup ─────────
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (handler: (req: Request, user: unknown) => unknown) =>
    (request: Request, _context: Record<string, unknown>) =>
      handler(request, { id: 'user-1', email: 'a@example.com', role: 'USER', rs: 0 }),
}))

// ─── Prisma ────────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pushSubscription: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

// ─── Logger ───────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────

const ENDPOINT = 'https://push.example.com/endpoint/abc123'
const KEYS = { p256dh: 'validp256dhkey1234567890ab', auth: 'validauthkey123' }
const CTX = { params: Promise.resolve({}) }

function makeSubscribeRequest(body: unknown, userAgent = 'TestBrowser/1.0') {
  return new NextRequest('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
    body: JSON.stringify(body),
  })
}

function makeUnsubscribeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/push/subscribe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 201 and upserts subscription for valid payload', async () => {
    const { POST } = await import('../route')
    const { prisma } = await import('@/lib/prisma')

    const res = await POST(makeSubscribeRequest({ endpoint: ENDPOINT, keys: KEYS }), CTX)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.success).toBe(true)
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: ENDPOINT },
        create: expect.objectContaining({ userId: 'user-1', endpoint: ENDPOINT, ...KEYS }),
        update: expect.objectContaining({ p256dh: KEYS.p256dh, auth: KEYS.auth }),
      }),
    )
  })

  it('removes any existing subscription for another user on the same endpoint before upserting', async () => {
    const { POST } = await import('../route')
    const { prisma } = await import('@/lib/prisma')

    await POST(makeSubscribeRequest({ endpoint: ENDPOINT, keys: KEYS }), CTX)

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: ENDPOINT, userId: { not: 'user-1' } },
    })
    // deleteMany must be called before upsert
    const deleteManyOrder = vi.mocked(prisma.pushSubscription.deleteMany).mock.invocationCallOrder[0]
    const upsertOrder = vi.mocked(prisma.pushSubscription.upsert).mock.invocationCallOrder[0]
    expect(deleteManyOrder).toBeLessThan(upsertOrder)
  })

  it('stores the User-Agent header in the subscription', async () => {
    const { POST } = await import('../route')
    const { prisma } = await import('@/lib/prisma')

    await POST(makeSubscribeRequest({ endpoint: ENDPOINT, keys: KEYS }, 'Chrome/120'), CTX)

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userAgent: 'Chrome/120' }),
      }),
    )
  })

  it('returns 400 for missing endpoint', async () => {
    const { POST } = await import('../route')
    const res = await POST(makeSubscribeRequest({ keys: KEYS }), CTX)
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-URL endpoint', async () => {
    const { POST } = await import('../route')
    const res = await POST(makeSubscribeRequest({ endpoint: 'not-a-url', keys: KEYS }), CTX)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing keys', async () => {
    const { POST } = await import('../route')
    const res = await POST(makeSubscribeRequest({ endpoint: ENDPOINT }), CTX)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing p256dh', async () => {
    const { POST } = await import('../route')
    const res = await POST(makeSubscribeRequest({ endpoint: ENDPOINT, keys: { auth: KEYS.auth } }), CTX)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/push/subscribe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 and deletes the subscription for the authenticated user', async () => {
    const { DELETE } = await import('../route')
    const { prisma } = await import('@/lib/prisma')

    const res = await DELETE(makeUnsubscribeRequest({ endpoint: ENDPOINT }), CTX)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: ENDPOINT, userId: 'user-1' },
    })
  })

  it('does not delete subscriptions belonging to other users', async () => {
    const { DELETE } = await import('../route')
    const { prisma } = await import('@/lib/prisma')

    await DELETE(makeUnsubscribeRequest({ endpoint: ENDPOINT }), CTX)

    const call = vi.mocked(prisma.pushSubscription.deleteMany).mock.calls[0][0]
    // Must scope the delete to the authenticated user
    expect(call?.where).toMatchObject({ userId: 'user-1' })
    expect(call?.where).not.toHaveProperty('userId.not')
  })

  it('returns 400 for missing endpoint', async () => {
    const { DELETE } = await import('../route')
    const res = await DELETE(makeUnsubscribeRequest({}), CTX)
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-URL endpoint', async () => {
    const { DELETE } = await import('../route')
    const res = await DELETE(makeUnsubscribeRequest({ endpoint: 'not-a-url' }), CTX)
    expect(res.status).toBe(400)
  })

  it('returns 200 even when no subscription exists (idempotent)', async () => {
    const { DELETE } = await import('../route')
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValueOnce({ count: 0 })

    const res = await DELETE(makeUnsubscribeRequest({ endpoint: ENDPOINT }), CTX)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/push/subscribe — user scoping', () => {
  it('scopes the subscription to the authenticated user id', async () => {
    // The withAuth mock injects user-1; verify the subscription is created for that user
    const { POST } = await import('../route')
    const { prisma } = await import('@/lib/prisma')

    await POST(makeSubscribeRequest({ endpoint: ENDPOINT, keys: KEYS }), CTX)

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'user-1' }),
      }),
    )
  })
})
