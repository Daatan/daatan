import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/services/translation', () => ({ sourceHash: (text: string) => `h:${text}` }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn(), findMany: vi.fn() },
    predictionTranslation: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getRelatedForecastLinks, getRecentForecastLinks, getVisibleTagLinks, toForecastLinks } from '../crawl-links'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const findMany = vi.mocked(prisma.prediction.findMany)
const findTranslations = vi.mocked(prisma.predictionTranslation.findMany)
const findTags = vi.mocked(prisma.tag.findMany)

const row = (id: string, slug: string | null = `${id}-slug`) => ({ id, slug, claimText: `claim ${id}` })

describe('toForecastLinks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('links English pages to English paths without a translation lookup', async () => {
    const links = await toForecastLinks([row('a'), row('b', null)], 'en', 5)
    expect(links).toEqual([
      { id: 'a', href: '/forecasts/a-slug', text: 'claim a' },
      { id: 'b', href: '/forecasts/b', text: 'claim b' },
    ])
    expect(findTranslations).not.toHaveBeenCalled()
  })

  it('uses the locale path only for a current translation, and lists those first', async () => {
    findTranslations.mockResolvedValue([
      { predictionId: 'b', translatedText: 'טענה ב', sourceHash: 'h:claim b' },
      { predictionId: 'c', translatedText: 'stale', sourceHash: 'h:old claim' },
    ] as never)
    const links = await toForecastLinks([row('a'), row('b'), row('c')], 'he', 2)
    expect(links).toEqual([
      { id: 'b', href: '/he/forecasts/b-slug', text: 'טענה ב' },
      { id: 'a', href: '/forecasts/a-slug', text: 'claim a' },
    ])
    expect(findTranslations).toHaveBeenCalledWith(expect.objectContaining({
      where: { predictionId: { in: ['a', 'b', 'c'] }, language: 'he', fieldName: 'claimText' },
    }))
  })
})

describe('getRelatedForecastLinks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefers forecasts sharing a tag and tops up with recent ones, excluding itself', async () => {
    findUnique.mockResolvedValue({ tags: [{ id: 't1' }] } as never)
    findMany.mockResolvedValueOnce([row('x')] as never).mockResolvedValueOnce([row('y'), row('z')] as never)

    const links = await getRelatedForecastLinks('self', 'en', 3)

    expect(links.map((l) => l.id)).toEqual(['x', 'y', 'z'])
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { status: 'ACTIVE', isPublic: true, id: { not: 'self' }, tags: { some: { id: { in: ['t1'] } } } },
      take: 3,
    }))
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { status: 'ACTIVE', isPublic: true, id: { notIn: ['self', 'x'] } },
      take: 2,
    }))
  })

  it('skips the tag query for an untagged forecast', async () => {
    findUnique.mockResolvedValue({ tags: [] } as never)
    findMany.mockResolvedValueOnce([row('y')] as never)
    expect((await getRelatedForecastLinks('self', 'en', 5)).map((l) => l.id)).toEqual(['y'])
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('fetches a wider candidate pool on locale pages', async () => {
    findUnique.mockResolvedValue({ tags: [] } as never)
    findMany.mockResolvedValueOnce([] as never)
    await getRelatedForecastLinks('self', 'ru', 5)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15 }))
  })
})

describe('getRecentForecastLinks', () => {
  it('reads the newest public ACTIVE forecasts', async () => {
    vi.clearAllMocks()
    findMany.mockResolvedValue([row('a')] as never)
    expect(await getRecentForecastLinks('en', 6)).toEqual([{ id: 'a', href: '/forecasts/a-slug', text: 'claim a' }])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ACTIVE', isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }))
  })
})

describe('getVisibleTagLinks', () => {
  it('returns tags with visible forecasts, most-used first then by name', async () => {
    findTags.mockResolvedValue([
      { name: 'Tech', slug: 'tech', _count: { predictions: 2 } },
      { name: 'Asia', slug: 'asia', _count: { predictions: 5 } },
      { name: 'Art', slug: 'art', _count: { predictions: 2 } },
    ] as never)
    expect((await getVisibleTagLinks()).map((t) => t.slug)).toEqual(['asia', 'art', 'tech'])
    expect(findTags).toHaveBeenCalledWith(expect.objectContaining({
      where: { predictions: { some: { status: 'ACTIVE', isPublic: true } } },
    }))
  })
})
