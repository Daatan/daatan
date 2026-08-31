import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/services/forecast-republish', () => ({ republishForecasts: vi.fn() }))

import { republishForecasts } from '@/lib/services/forecast-republish'
import { POST } from '../republish/route'

const republish = vi.mocked(republishForecasts)

function req(body: unknown, headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/admin/forecasts/republish', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/forecasts/republish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    republish.mockResolvedValue({ mode: 'dry-run', ok: 0, unchanged: 0, failed: 0, forecasts: [] })
  })

  it('defaults to dry-run when mode is omitted', async () => {
    // The safety property of the whole route (same as remediate, #1493): a call that
    // forgets the flag computes every would-be number and writes nothing.
    const res = await POST(req({ forecastIds: ['p1'] }))

    expect(res.status).toBe(200)
    expect(republish).toHaveBeenCalledWith(['p1'], false)
  })

  it('applies only on an explicit mode=apply', async () => {
    await POST(req({ forecastIds: ['p1', 'p2'], mode: 'apply' }))

    expect(republish).toHaveBeenCalledWith(['p1', 'p2'], true)
  })

  it('rejects an unrecognised mode rather than falling back to dry-run', async () => {
    const res = await POST(req({ forecastIds: ['p1'], mode: 'aply' }))

    expect(res.status).toBe(400)
    expect(republish).not.toHaveBeenCalled()
  })

  it('rejects a missing or empty id list', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req({ forecastIds: [] }))).status).toBe(400)
    expect((await POST(req({ forecastIds: 'p1' }))).status).toBe(400)
    expect(republish).not.toHaveBeenCalled()
  })

  it('caps the batch so one call cannot queue an unbounded number of Oracul aggregations', async () => {
    const res = await POST(req({ forecastIds: Array.from({ length: 51 }, (_, i) => `p${i}`), mode: 'apply' }))

    expect(res.status).toBe(400)
    expect(republish).not.toHaveBeenCalled()
  })

  it('falls through to session auth without the cron secret', async () => {
    const res = await POST(req({ forecastIds: ['p1'] }, {}))

    expect(res.status).toBe(401)
    expect(republish).not.toHaveBeenCalled()
  })
})
