import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-middleware', () => ({
  withAuth: (h: (req: NextRequest, u: unknown, c: unknown) => unknown) =>
    (req: NextRequest) => h(req, { id: 'a1', role: 'ADMIN' }, { params: {} }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: { findUnique: vi.fn() },
    punditTagRating: { deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    punditTagRatingArchive: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'arch-1' }),
      delete: vi.fn(),
    },
  },
}))

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'cron-sec' } }))
vi.mock('@/lib/cron-auth', () => ({ secretsMatch: (a: string, b: string) => a === b }))

vi.mock('@/lib/services/tag-ratings', () => ({
  ensurePunditTagRatingsSeeded: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const ratingRows = (n: number, elo = 1500) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`, personId: `p${i}`, personName: null, tagId: 'tag-1', elo, mu: 1500, sigma: 350,
    volatility: 0.06, totalPredictions: 4, correctPredictions: 2, updatedAt: new Date('2026-11-10T14:46:28Z'),
  }))

describe('POST /api/admin/pundit-ratings/recalculate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s for an unknown tag slug', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const res = await POST(
      new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate?tag=not-a-real-tag'),
    )

    expect(res.status).toBe(404)
  })

  it('defaults to the israeli-elections-2026 tag when none is given', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { ensurePunditTagRatingsSeeded } = await import('@/lib/services/tag-ratings')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce(ratingRows(5) as never)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    await POST(new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate'))

    expect(prisma.tag.findUnique).toHaveBeenCalledWith({ where: { slug: 'israeli-elections-2026' }, select: { id: true } })
    expect(ensurePunditTagRatingsSeeded).toHaveBeenCalledWith('tag-1', 'israeli-elections-2026')
  })

  it('deletes existing rows before reseeding, and reports the resulting count', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce(ratingRows(8) as never)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const res = await POST(
      new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate?tag=israeli-elections-2026'),
    )
    const body = await res.json()

    expect(prisma.punditTagRating.deleteMany).toHaveBeenCalledWith({ where: { tagId: 'tag-1' } })
    expect(body).toMatchObject({ tagSlug: 'israeli-elections-2026', updated: 8 })
  })

  it('runs headlessly via a matching x-cron-secret, without needing an ADMIN session (daatan#1293)', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce(ratingRows(3) as never)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const res = await POST(
      new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate?tag=israeli-elections-2026', {
        method: 'POST',
        headers: { 'x-cron-secret': 'cron-sec' },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ tagSlug: 'israeli-elections-2026', updated: 3 })
  })
})

describe('ratings archive (daatan#2144)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('archives the rows it replaces, labelling the first archive with the previous rule set', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRatingArchive.count).mockResolvedValue(0)
    vi.mocked(prisma.punditTagRating.findMany)
      .mockResolvedValueOnce(ratingRows(3, 1700) as never)
      .mockResolvedValueOnce(ratingRows(2, 1600) as never)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const body = await (await POST(new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate'))).json()

    const archived = vi.mocked(prisma.punditTagRatingArchive.create).mock.calls[0][0].data
    expect(archived.scoringVersion).toBe('v1-uncut')
    expect(archived.payload).toHaveLength(3)
    expect(prisma.punditTagRatingArchive.delete).not.toHaveBeenCalled()
    expect(body).toMatchObject({ changed: true, scoringVersion: 'v2-outcome-cutoff', updated: 2 })
    // archive is written before the delete
    expect(vi.mocked(prisma.punditTagRatingArchive.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.punditTagRating.deleteMany).mock.invocationCallOrder[0],
    )
  })

  it('labels later archives with the current rule set', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRatingArchive.count).mockResolvedValue(1)
    vi.mocked(prisma.punditTagRating.findMany)
      .mockResolvedValueOnce(ratingRows(3, 1700) as never)
      .mockResolvedValueOnce(ratingRows(3, 1650) as never)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    await POST(new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate'))

    expect(vi.mocked(prisma.punditTagRatingArchive.create).mock.calls[0][0].data.scoringVersion).toBe('v2-outcome-cutoff')
  })

  it('keeps no archive when the recalculation changed nothing', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRatingArchive.create).mockResolvedValue({ id: 'arch-9' } as never)
    vi.mocked(prisma.punditTagRating.findMany)
      .mockResolvedValueOnce(ratingRows(3) as never)
      .mockResolvedValueOnce(ratingRows(3) as never)

    const { POST } = await import('@/app/api/admin/pundit-ratings/recalculate/route')
    const body = await (await POST(new NextRequest('http://localhost/api/admin/pundit-ratings/recalculate'))).json()

    expect(prisma.punditTagRatingArchive.delete).toHaveBeenCalledWith({ where: { id: 'arch-9' } })
    expect(body.changed).toBe(false)
  })
})
