import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
})) // withAuth's error path notifies on 5xx — keep it a no-op in tests

vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/services/evidence-pool', () => ({
  getPoolArticles: vi.fn(),
  isUsablePoolRow: vi.fn(),
}))

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getPoolArticles, isUsablePoolRow } from '@/lib/services/evidence-pool'
import { GET } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const mockFindUnique = vi.mocked(prisma.prediction.findUnique)
const mockGetPoolArticles = vi.mocked(getPoolArticles)
const mockIsUsable = vi.mocked(isUsablePoolRow)

const req = () => new NextRequest('http://localhost/api/admin/forecasts/p1/evidence-pool')
const ctx = { params: Promise.resolve({ id: 'p1' }) }

function article(overrides: Partial<{ id: string; supersededAt: string | null; status: string }> = {}) {
  return { id: 'a1', supersededAt: null, status: 'COMPLETE', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
  mockFindUnique.mockResolvedValue({ id: 'p1' } as never)
})

describe('GET /api/admin/forecasts/[id]/evidence-pool', () => {
  it('404s when the forecast does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    expect(mockGetPoolArticles).not.toHaveBeenCalled()
  })

  it('counts poolSize/usableSize over current-version rows only, excluding superseded corrections (daatan#1521)', async () => {
    const current = [article({ id: 'a1' }), article({ id: 'a2' }), article({ id: 'a3', status: 'FAILED' })]
    const superseded = [article({ id: 'a1-old', supersededAt: '2026-01-01T00:00:00Z' })]
    mockGetPoolArticles.mockResolvedValue([...current, ...superseded] as never)
    // a1 and a2 are usable, a3 (FAILED) is not — the superseded row is never asked
    mockIsUsable.mockImplementation((a: unknown) => (a as { id: string }).id === 'a1' || (a as { id: string }).id === 'a2')

    const res = await GET(req(), ctx)
    const body = await res.json()

    expect(body.poolSize).toBe(3)
    expect(body.usableSize).toBe(2)
    expect(body.articles).toHaveLength(4)
    expect(mockIsUsable).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'a1-old' }))
  })
})
