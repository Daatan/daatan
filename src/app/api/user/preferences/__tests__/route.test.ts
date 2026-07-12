import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-middleware', () => ({
  withAuth:
    (handler: (req: Request, user: unknown) => unknown) =>
    (request: Request, _context: Record<string, unknown>) =>
      handler(request, { id: 'user-1', email: 'a@example.com', role: 'USER', rs: 0 }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { GET, PATCH } from '../route'

const findUnique = vi.mocked(prisma.user.findUnique)
const update = vi.mocked(prisma.user.update)
const CTX = { params: Promise.resolve({}) }

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/user/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue({ showAiPanel: true } as never)
  update.mockResolvedValue({ showAiPanel: true } as never)
})

describe('GET /api/user/preferences', () => {
  it("returns the current user's flag, scoped to their own row", async () => {
    const res = await GET(new NextRequest('http://localhost/api/user/preferences'), CTX)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ showAiPanel: true })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { showAiPanel: true },
    })
  })

  it('defaults to false when the row is missing', async () => {
    findUnique.mockResolvedValue(null as never)
    const res = await GET(new NextRequest('http://localhost/api/user/preferences'), CTX)
    expect(await res.json()).toEqual({ showAiPanel: false })
  })
})

describe('PATCH /api/user/preferences', () => {
  it('updates only the whitelisted boolean, only for the session user', async () => {
    update.mockResolvedValue({ showAiPanel: false } as never)
    const res = await PATCH(patchReq({ showAiPanel: false }), CTX)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ showAiPanel: false })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { showAiPanel: false },
      select: { showAiPanel: true },
    })
  })

  it('400s on a non-boolean value, writing nothing', async () => {
    for (const bad of ['true', 1, null, undefined, { nested: true }]) {
      const res = await PATCH(patchReq({ showAiPanel: bad }), CTX)
      expect(res.status).toBe(400)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('ignores extra fields — nothing but the whitelisted flag reaches the DB', async () => {
    await PATCH(patchReq({ showAiPanel: true, role: 'ADMIN', rs: 9999 }), CTX)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0].data).toEqual({ showAiPanel: true })
  })
})
