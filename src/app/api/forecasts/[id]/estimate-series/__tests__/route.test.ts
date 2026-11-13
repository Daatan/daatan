/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { findFirst, findMany, authMock } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  authMock: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findFirst }, contextSnapshot: { findMany } },
}))

import { GET } from '../route'

const call = (id: string) =>
  GET(new NextRequest(`http://localhost/api/forecasts/${id}/estimate-series`), { params: Promise.resolve({ id }) })

const row = (id: string, p: number | null) => ({
  id, createdAt: new Date('2026-11-01T00:00:00Z'), externalProbability: p, oracleMean: p,
  insufficientData: p === null, materialChange: true, origin: 'news-indexer', engine: 'v1',
  schemaVersion: '1.3', articlesUsed: 12, evidenceAt: null,
})

describe('GET /api/forecasts/[id]/estimate-series', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(null)
  })

  it('404s an unknown forecast', async () => {
    findFirst.mockResolvedValue(null)
    const res = await call('nope')
    expect(res.status).toBe(404)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('404s a private forecast for a stranger', async () => {
    findFirst.mockResolvedValue({ id: 'p1', isPublic: false, authorId: 'author' })
    authMock.mockResolvedValue({ user: { id: 'someone-else', role: 'USER' } })
    expect((await call('p1')).status).toBe(404)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('serves a private forecast to its author and to an admin', async () => {
    findFirst.mockResolvedValue({ id: 'p1', isPublic: false, authorId: 'author' })
    findMany.mockResolvedValue([])
    authMock.mockResolvedValue({ user: { id: 'author', role: 'USER' } })
    expect((await call('p1')).status).toBe(200)
    authMock.mockResolvedValue({ user: { id: 'x', role: 'ADMIN' } })
    expect((await call('p1')).status).toBe(200)
  })

  it('reads evidence snapshots only, oldest first, scalars only', async () => {
    findFirst.mockResolvedValue({ id: 'p1', isPublic: true, authorId: 'a' })
    findMany.mockResolvedValue([row('s1', 40), row('s2', null)])
    const res = await call('my-slug')
    expect(res.status).toBe(200)

    const args = findMany.mock.calls[0][0]
    expect(args.where).toEqual({ predictionId: 'p1', kind: 'evidence' })
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    for (const heavy of ['oracleSnapshot', 'sources', 'sourcesSummary', 'sourcesDelta', 'summary', 'meta']) {
      expect(args.select).not.toHaveProperty(heavy)
    }

    const body = await res.json()
    expect(body.predictionId).toBe('p1')
    expect(body.points.map((p: { id: string }) => p.id)).toEqual(['s1', 's2'])
    expect(body.points[0].probability).toBe(40)
    expect(body.points[0]).not.toHaveProperty('externalProbability')
    expect(body.points[1].insufficientData).toBe(true)
  })
})
