import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockFindMany, mockCount, mockRefresh, mockWithAuthHandler } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockRefresh: vi.fn(),
  mockWithAuthHandler: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      count: (...a: unknown[]) => mockCount(...a),
    },
  },
}))
vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'cron-sec' } }))
vi.mock('@/lib/cron-auth', () => ({ secretsMatch: (a: string, b: string) => a === b }))
vi.mock('@/lib/services/oracle-backfill', () => ({
  refreshOracleSnapshot: (...a: unknown[]) => mockRefresh(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
// withAuth — the non-cron path. Record that it was used and return a 401 (no session in test).
vi.mock('@/lib/api-middleware', () => ({
  withAuth: () => {
    mockWithAuthHandler()
    return async () => new Response('unauth', { status: 401 })
  },
}))

const makeRequest = (secret?: string, limit = 5) =>
  new NextRequest(`http://localhost/api/admin/forecasts/backfill-oracle-sources?limit=${limit}`, {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  })

describe('POST /api/admin/forecasts/backfill-oracle-sources', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the backfill when the x-cron-secret matches (no session needed)', async () => {
    mockFindMany.mockResolvedValue([{ id: 'p1', claimText: 'q1' }, { id: 'p2', claimText: 'q2' }])
    mockRefresh
      .mockResolvedValueOnce({ status: 'ok', sources: 3 })
      .mockResolvedValueOnce({ status: 'no-articles' })
    mockCount.mockResolvedValue(7)

    const { POST } = await import('@/app/api/admin/forecasts/backfill-oracle-sources/route')
    const res = await POST(makeRequest('cron-sec'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 2, ok: 1, noArticles: 1, noOracle: 0, unchanged: 0, failed: 0, remaining: 7 })
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it('falls through to ADMIN-session auth when the secret is wrong/missing', async () => {
    const { POST } = await import('@/app/api/admin/forecasts/backfill-oracle-sources/route')
    expect((await POST(makeRequest('nope'))).status).toBe(401)
    expect((await POST(makeRequest())).status).toBe(401)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('counts a thrown refresh as failed without aborting the batch', async () => {
    mockFindMany.mockResolvedValue([{ id: 'p1', claimText: 'q1' }, { id: 'p2', claimText: 'q2' }])
    mockRefresh.mockRejectedValueOnce(new Error('oracle down')).mockResolvedValueOnce({ status: 'ok', sources: 1 })
    mockCount.mockResolvedValue(0)

    const { POST } = await import('@/app/api/admin/forecasts/backfill-oracle-sources/route')
    const res = await POST(makeRequest('cron-sec'))
    expect(await res.json()).toMatchObject({ processed: 2, ok: 1, failed: 1, remaining: 0 })
  })
})
