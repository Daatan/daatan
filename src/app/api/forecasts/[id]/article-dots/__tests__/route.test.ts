import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { findFirst, queryRaw, authMock } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  queryRaw: vi.fn(),
  authMock: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findFirst }, $queryRaw: queryRaw },
}))

import { GET } from '../route'
import { MAX_ARTICLE_DOTS } from '@/lib/article-dots'

const call = (id: string) =>
  GET(new NextRequest(`http://localhost/api/forecasts/${id}/article-dots`), { params: Promise.resolve({ id }) })

const forecast = (over: Record<string, unknown> = {}) => ({
  id: 'p1', isPublic: true, authorId: 'author', status: 'ACTIVE', ...over,
})

const sourceRow = (url: string, stance: number | null, firstSeen: string, poolSize = 3) => ({
  readAt: new Date('2026-11-03T00:00:00Z'), firstSeenAt: new Date(firstSeen), url, stance, certainty: 0.5,
  title: `T ${url}`, sourceName: 'Src', outletName: null, poolSize,
})

describe('GET /api/forecasts/[id]/article-dots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(null)
    queryRaw.mockResolvedValue([])
  })

  it('404s an unknown forecast without reading snapshots', async () => {
    findFirst.mockResolvedValue(null)
    expect((await call('nope')).status).toBe(404)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it.each([
    ['private', { isPublic: false }],
    ['draft', { status: 'DRAFT' }],
    ['pending approval', { status: 'PENDING_APPROVAL' }],
  ])('404s a %s forecast for anonymous visitors and strangers, without reading snapshots', async (_label, over) => {
    findFirst.mockResolvedValue(forecast(over))
    expect((await call('p1')).status).toBe(404)
    authMock.mockResolvedValue({ user: { id: 'someone-else', role: 'USER' } })
    expect((await call('p1')).status).toBe(404)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('treats a failing session lookup as anonymous', async () => {
    findFirst.mockResolvedValue(forecast({ isPublic: false }))
    authMock.mockRejectedValue(new Error('jwt decode failed'))
    expect((await call('p1')).status).toBe(404)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('serves a private draft to its author, an admin and an approver — the forecast page’s rule', async () => {
    findFirst.mockResolvedValue(forecast({ isPublic: false, status: 'DRAFT' }))
    for (const user of [{ id: 'author', role: 'USER' }, { id: 'x', role: 'ADMIN' }, { id: 'y', role: 'APPROVER' }]) {
      authMock.mockResolvedValue({ user })
      expect((await call('p1')).status).toBe(200)
    }
  })

  it('serves a public forecast without touching the session, keyed by the resolved id', async () => {
    findFirst.mockResolvedValue(forecast())
    // Three of a five-article pool came back: the query's cap cut two.
    queryRaw.mockResolvedValue([
      sourceRow('https://a.com/1', 0.4, '2026-11-01T00:00:00Z', 5),
      sourceRow('https://www.a.com/1', -0.4, '2026-11-02T00:00:00Z', 5),
      sourceRow('https://b.com/2', null, '2026-11-02T00:00:00Z', 5),
    ])
    const res = await call('my-slug')
    expect(res.status).toBe(200)
    expect(authMock).not.toHaveBeenCalled()
    expect(findFirst.mock.calls[0][0].where).toEqual({ OR: [{ id: 'my-slug' }, { slug: 'my-slug' }] })

    // The query is bound to the resolved id, never to the slug from the URL, and capped.
    const sql = queryRaw.mock.calls[0][0] as { values: unknown[] }
    expect(sql.values).toEqual(['p1', 'p1', MAX_ARTICLE_DOTS])

    const body = await res.json()
    expect(body.predictionId).toBe('p1')
    expect(body.poolSize).toBe(5)
    expect(body.truncated).toBe(true)
    expect(body.dots).toEqual([
      {
        url: 'https://www.a.com/1',
        title: 'T https://www.a.com/1',
        outlet: 'Src',
        outletPath: '/sources/a.com',
        firstSeenAt: '2026-11-01T00:00:00.000Z',
        probYes: 0.3,
        certainty: 0.5,
        side: 'no',
      },
    ])
  })

  it('an empty pool is an empty series, not a truncated one', async () => {
    findFirst.mockResolvedValue(forecast())
    const body = await (await call('p1')).json()
    expect(body).toEqual({ predictionId: 'p1', dots: [], poolSize: 0, truncated: false })
  })
})
