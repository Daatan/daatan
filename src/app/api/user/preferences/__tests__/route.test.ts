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
  findUnique.mockResolvedValue({ showAiPanel: true, feedTags: ['AI'] } as never)
  update.mockResolvedValue({ showAiPanel: true, feedTags: [] } as never)
})

describe('GET /api/user/preferences', () => {
  it("returns the current user's preferences, scoped to their own row", async () => {
    const res = await GET(new NextRequest('http://localhost/api/user/preferences'), CTX)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ showAiPanel: true, feedTags: ['AI'] })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { showAiPanel: true, feedTags: true },
    })
  })

  it('defaults to false / no tags when the row is missing', async () => {
    findUnique.mockResolvedValue(null as never)
    const res = await GET(new NextRequest('http://localhost/api/user/preferences'), CTX)
    expect(await res.json()).toEqual({ showAiPanel: false, feedTags: [] })
  })
})

describe('PATCH /api/user/preferences', () => {
  it('updates only the whitelisted boolean, only for the session user', async () => {
    update.mockResolvedValue({ showAiPanel: false, feedTags: [] } as never)
    const res = await PATCH(patchReq({ showAiPanel: false }), CTX)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ showAiPanel: false, feedTags: [] })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { showAiPanel: false },
      select: { showAiPanel: true, feedTags: true },
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

  // daatan#2203
  it('a tags-only PATCH writes only feedTags (deduped), leaving showAiPanel untouched', async () => {
    const res = await PATCH(patchReq({ feedTags: ['AI', 'Economy', 'AI'] }), CTX)
    expect(res.status).toBe(200)
    expect(update.mock.calls[0][0].data).toEqual({ feedTags: ['AI', 'Economy'] })
  })

  it('accepts an empty list (clearing the remembered filter)', async () => {
    await PATCH(patchReq({ feedTags: [] }), CTX)
    expect(update.mock.calls[0][0].data).toEqual({ feedTags: [] })
  })

  it('400s on bad feedTags or an empty body, writing nothing', async () => {
    for (const bad of [{ feedTags: 'AI' }, { feedTags: [1] }, { feedTags: [''] }, { feedTags: ['x'.repeat(51)] }, { feedTags: Array(21).fill('AI') }, {}]) {
      const res = await PATCH(patchReq(bad), CTX)
      expect(res.status).toBe(400)
    }
    expect(update).not.toHaveBeenCalled()
  })
})
