import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-middleware', () => ({
  withAuth: (h: (req: NextRequest, u: unknown, c: unknown) => unknown) =>
    (req: NextRequest) => h(req, { id: 'a1', role: 'ADMIN' }, { params: {} }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: { findUnique: vi.fn() },
    punditTagRating: { deleteMany: vi.fn(), count: vi.fn() },
  },
}))

vi.mock('@/lib/services/tag-ratings', () => ({
  ensurePunditTagRatingsSeeded: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('POST /api/admin/pundit-ratings/recalculate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s for an unknown tag slug', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const res = await POST(
      new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate?tag=not-a-real-tag'),
      { params: Promise.resolve({}) } as never,
    )

    expect(res.status).toBe(404)
  })

  it('defaults to the israeli-elections-2026 tag when none is given', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { ensurePunditTagRatingsSeeded } = await import('@/lib/services/tag-ratings')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.count).mockResolvedValue(5)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    await POST(new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate'), { params: Promise.resolve({}) } as never)

    expect(prisma.tag.findUnique).toHaveBeenCalledWith({ where: { slug: 'israeli-elections-2026' }, select: { id: true } })
    expect(ensurePunditTagRatingsSeeded).toHaveBeenCalledWith('tag-1', 'israeli-elections-2026')
  })

  it('deletes existing rows before reseeding, and reports the resulting count', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.count).mockResolvedValue(8)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const res = await POST(
      new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate?tag=israeli-elections-2026'),
      { params: Promise.resolve({}) } as never,
    )
    const body = await res.json()

    expect(prisma.punditTagRating.deleteMany).toHaveBeenCalledWith({ where: { tagId: 'tag-1' } })
    expect(body).toMatchObject({ tagSlug: 'israeli-elections-2026', updated: 8 })
  })
})
