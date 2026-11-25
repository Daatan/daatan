import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockTranslations } = vi.hoisted(() => ({
  mockPrisma: {
    evidencePoolArticle: { findMany: vi.fn() },
    prediction: { findMany: vi.fn() },
  },
  mockTranslations: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/services/translation', () => ({ getCachedClaimTranslations: mockTranslations }))

import { getOutletForecastRows, getPublicForecastLinks } from '../outlet-forecasts'

const at = (iso: string) => new Date(iso)

describe('outlet-forecasts (#2320)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslations.mockResolvedValue(new Map())
  })

  it('links only public, approved forecasts, preferring a cached translation of the title', async () => {
    mockPrisma.prediction.findMany.mockResolvedValue([
      { id: 'f1', slug: 'slug-1', claimText: 'Claim one', status: 'ACTIVE' },
      { id: 'f2', slug: null, claimText: 'Claim two', status: 'RESOLVED_CORRECT' },
    ])
    mockTranslations.mockResolvedValue(new Map([['f1', 'Утверждение один']]))

    const links = await getPublicForecastLinks(['f1', 'f2', 'f1', 'private'], 'ru')

    const where = mockPrisma.prediction.findMany.mock.calls[0][0].where
    expect(where.id.in).toEqual(['f1', 'f2', 'private'])
    expect(where.isPublic).toBe(true)
    expect(where.status.notIn).toEqual(['DRAFT', 'PENDING_APPROVAL'])
    expect(mockTranslations).toHaveBeenCalledWith(['f1', 'f2', 'private'], 'ru')
    expect(links.get('f1')).toEqual({ href: '/forecasts/slug-1', title: 'Утверждение один', status: 'ACTIVE' })
    expect(links.get('f2')?.href).toBe('/forecasts/f2')
    expect(links.has('private')).toBe(false)
  })

  it('makes no query for no ids', async () => {
    expect((await getPublicForecastLinks([], 'en')).size).toBe(0)
    expect(mockPrisma.prediction.findMany).not.toHaveBeenCalled()
  })

  it('builds one row per public forecast, its lean and trend in article order', async () => {
    mockPrisma.evidencePoolArticle.findMany.mockResolvedValue([
      { predictionId: 'f1', stance: -1.0, publishedDate: '2026-11-10', addedAt: at('2026-11-10T09:00:00Z') },
      { predictionId: 'f1', stance: 1.0, publishedDate: '2026-11-01', addedAt: at('2026-11-02T09:00:00Z') },
      { predictionId: 'f1', stance: 0.0, publishedDate: null, addedAt: at('2026-11-05T09:00:00Z') },
      { predictionId: 'hidden', stance: 0.9, publishedDate: '2026-11-01', addedAt: at('2026-11-01T09:00:00Z') },
    ])
    mockPrisma.prediction.findMany.mockResolvedValue([
      { id: 'f1', slug: 's1', claimText: 'Claim', status: 'RESOLVED_WRONG' },
    ])

    const rows = await getOutletForecastRows('Ynet', ['ynet.co.il'], 'en')

    const where = mockPrisma.evidencePoolArticle.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      supersededAt: null, excluded: false, status: 'COMPLETE',
      OR: [{ source: { in: ['ynet.co.il'] } }, { outletName: 'Ynet' }],
      prediction: { isPublic: true, status: { notIn: ['DRAFT', 'PENDING_APPROVAL'] } },
    })
    expect(rows).toHaveLength(1)
    // Stance is -1..1. Oldest first: 1 (Nov 1), 0 (Nov 5), -1 (Nov 10) → running means 1, 0.5, 0
    // → 99 (publish cap), 75, 50.
    expect(rows[0]).toMatchObject({
      forecastId: 'f1', href: '/forecasts/s1', title: 'Claim', state: 'didNotHappen',
      articles: 3, lastArticle: '2026-11-10',
    })
    expect(rows[0].trend).toEqual([99, 75, 50])
    expect(rows[0].lean).toBe(50)
  })

  it('fails open to no rows', async () => {
    mockPrisma.evidencePoolArticle.findMany.mockRejectedValue(new Error('db down'))
    expect(await getOutletForecastRows('Ynet', [], 'en')).toEqual([])
  })
})
