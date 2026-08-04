import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret' },
}))

vi.mock('@/lib/services/evidence-pool', () => ({
  getPoolThroughput: vi.fn(),
}))

import { env } from '@/env'
import { getPoolThroughput } from '@/lib/services/evidence-pool'
import { GET } from '../route'

const throughput = vi.mocked(getPoolThroughput)

function req(query = '', headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest(`http://localhost/api/cron/evidence-pool-stats${query}`, { headers })
}

describe('GET /api/cron/evidence-pool-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(env).BOT_RUNNER_SECRET = 'test-secret'
    throughput.mockResolvedValue({ attempted: 200, usable: 90 })
  })

  it('401s without the cron secret, querying nothing', async () => {
    const res = await GET(req('', {}))
    expect(res.status).toBe(401)
    expect(throughput).not.toHaveBeenCalled()
  })

  it('401s with a wrong secret', async () => {
    const res = await GET(req('', { 'x-cron-secret': 'wrong' }))
    expect(res.status).toBe(401)
    expect(throughput).not.toHaveBeenCalled()
  })

  it('401s when the server has no secret configured, even with a matching header', async () => {
    vi.mocked(env).BOT_RUNNER_SECRET = ''
    const res = await GET(req('', { 'x-cron-secret': '' }))
    expect(res.status).toBe(401)
    expect(throughput).not.toHaveBeenCalled()
  })

  it('returns both counts over the default 7-day window', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, days: 7, attempted: 200, usable: 90 })
    expect(throughput).toHaveBeenCalledWith(7)
  })

  it('honours an explicit days window', async () => {
    const res = await GET(req('?days=30'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ days: 30 })
    expect(throughput).toHaveBeenCalledWith(30)
  })

  // Rejecting rather than clamping is the point: a silently different window would
  // divide spend for one period by output from another, and read as a real ratio.
  it.each(['?days=0', '?days=-1', '?days=91', '?days=7.5', '?days=abc', '?days='])(
    '400s on %s without querying',
    async (query) => {
      const res = await GET(req(query))
      expect(res.status).toBe(400)
      expect(throughput).not.toHaveBeenCalled()
    },
  )

  it('500s, rather than reporting zeros, when the query fails', async () => {
    throughput.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    // A broken denominator must never reach the report as a usable number.
    await expect(res.json()).resolves.not.toMatchObject({ usable: 0 })
  })
})
