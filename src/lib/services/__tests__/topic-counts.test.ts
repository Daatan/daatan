import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/prisma', () => ({ prisma: { tag: { findMany } } }))

import { getOpenTopicCounts } from '../topic-counts'

describe('getOpenTopicCounts (daatan#2330)', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('counts open public forecasts per standard topic slug', async () => {
    findMany.mockResolvedValue([
      { slug: 'politics', _count: { predictions: 47 } },
      { slug: 'ai', _count: { predictions: 3 } },
    ])
    expect(await getOpenTopicCounts()).toEqual({ politics: 47, ai: 3 })
    const args = findMany.mock.calls[0][0]
    expect(args.where.slug.in).toContain('us-politics')
    expect(args.select._count.select.predictions).toEqual({ where: { status: 'ACTIVE', isPublic: true } })
  })

  it('returns no counts on a DB error, so the filter falls back to every topic', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect(await getOpenTopicCounts()).toEqual({})
  })
})
