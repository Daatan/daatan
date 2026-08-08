import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({
  env: { NEWS_INDEXER_URL: 'https://scrapper.test', NEWS_INDEXER_API_KEY: 'test-key' },
}))
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { evidencePoolArticle: { groupBy: vi.fn() } },
}))

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const mockGroupBy = vi.mocked(
  prisma.evidencePoolArticle.groupBy as unknown as (args?: unknown) => Promise<unknown>,
)
const mockFetch = vi.fn()

const req = () => new NextRequest('http://localhost/api/admin/news-indexer/sources')
const ctx = { params: Promise.resolve({}) }

const niPayload = (sources: unknown[]) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ sources, total: sources.length, enabled: sources.length }),
})

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = mockFetch
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
  mockGroupBy.mockResolvedValue([])
})

describe('sources proxy — access control', () => {
  it('rejects an unauthenticated caller with 401 and never calls upstream', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a non-admin caller with 403', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
    const res = await GET(req(), ctx)
    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('sources proxy — extraction yield merge', () => {
  it('folds COMPLETE/FAILED counts over matchKeys, ignoring PENDING, and rounds yield to 4 decimals', async () => {
    mockFetch.mockResolvedValue(niPayload([
      { type: 'rss', name: 'BBC News', domain: 'bbc.com', matchKeys: ['bbc.com', 'bbc.co.uk'] },
      { type: 'rss', name: 'Reuters', domain: 'reuters.com', matchKeys: ['reuters.com'] },
    ]))
    mockGroupBy.mockResolvedValue([
      { source: 'bbc.com', status: 'COMPLETE', _count: 3 },
      { source: 'bbc.co.uk', status: 'COMPLETE', _count: 1 },
      { source: 'bbc.co.uk', status: 'FAILED', _count: 1 },
      { source: 'bbc.com', status: 'PENDING', _count: 5 },
      { source: 'reuters.com', status: 'COMPLETE', _count: 1 },
      { source: 'reuters.com', status: 'FAILED', _count: 2 },
    ])

    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources[0].extraction).toEqual({ complete: 4, failed: 1, yield: 0.8 })
    expect(body.sources[1].extraction).toEqual({ complete: 1, failed: 2, yield: 0.3333 })
  })

  it('falls back to name (telegram) / domain when matchKeys is absent, degrading to zeros when neither maps', async () => {
    mockFetch.mockResolvedValue(niPayload([
      { type: 'telegram', name: 'Edy Cohen', domain: null },
      { type: 'rss', name: 'Phys.org', domain: 'phys.org' },
      { type: 'youtube', name: 'Some Channel', domain: null },
    ]))
    mockGroupBy.mockResolvedValue([
      { source: 'Edy Cohen', status: 'COMPLETE', _count: 2 },
      { source: 'phys.org', status: 'FAILED', _count: 1 },
    ])

    const res = await GET(req(), ctx)
    const body = await res.json()
    expect(body.sources[0].extraction).toEqual({ complete: 2, failed: 0, yield: 1 })
    expect(body.sources[1].extraction).toEqual({ complete: 0, failed: 1, yield: 0 })
    expect(body.sources[2].extraction).toEqual({ complete: 0, failed: 0, yield: null })
  })

  it('degrades to zero counts when the groupBy fails instead of failing the panel', async () => {
    mockFetch.mockResolvedValue(niPayload([
      { type: 'rss', name: 'BBC News', domain: 'bbc.com', matchKeys: ['bbc.com'] },
    ]))
    mockGroupBy.mockRejectedValue(new Error('db down'))

    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources[0].extraction).toEqual({ complete: 0, failed: 0, yield: null })
  })

  it('passes a non-ok upstream response through untouched, without querying the DB', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'upstream down' }),
    })

    const res = await GET(req(), ctx)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream down' })
    expect(mockGroupBy).not.toHaveBeenCalled()
  })
})
