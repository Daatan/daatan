import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
})) // withAuth's error path notifies on 5xx — keep it a no-op in tests

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: { count: vi.fn(), groupBy: vi.fn() },
  },
}))

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const mockCount = vi.mocked(prisma.evidencePoolArticle.count)
const mockGroupBy = vi.mocked(prisma.evidencePoolArticle.groupBy)

const req = (q = '') => new NextRequest(`http://localhost/api/admin/evidence-pool/degraded-fetch-sweep${q}`)
const ctx = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
  mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 3 } }] as never)
})

describe('GET /api/admin/evidence-pool/degraded-fetch-sweep', () => {
  it('splits rows into reachable (null contentHash) vs gated, not just a single overstated count (daatan#1466)', async () => {
    mockCount.mockResolvedValueOnce(140).mockResolvedValueOnce(3) // rows, then reachable
    const res = await GET(req(), ctx)
    const body = await res.json()
    expect(body).toEqual({ rows: 140, reachable: 3, gated: 137, predictions: 1 })
  })

  it('reachable count query filters on contentHash: null, not the raw where clause', async () => {
    mockCount.mockResolvedValueOnce(10).mockResolvedValueOnce(10)
    await GET(req(), ctx)
    expect(mockCount.mock.calls[1][0]).toMatchObject({ where: expect.objectContaining({ contentHash: null }) })
  })
})
