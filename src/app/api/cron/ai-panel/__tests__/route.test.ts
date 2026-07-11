import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret' },
}))

vi.mock('@/lib/services/ai-panel', () => ({
  runPanelSweep: vi.fn(),
}))

import { env } from '@/env'
import { runPanelSweep } from '@/lib/services/ai-panel'
import { GET } from '../route'

const sweep = vi.mocked(runPanelSweep)

function req(query = '', headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest(`http://localhost/api/cron/ai-panel${query}`, { headers })
}

const okSummary = { considered: 3, written: 2, skipped: 1, failed: 0, dryRun: 0 }

describe('GET /api/cron/ai-panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sweep.mockResolvedValue(okSummary)
  })

  it('401s without the cron secret, calling nothing', async () => {
    const res = await GET(req('', {}))
    expect(res.status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('401s with a wrong secret', async () => {
    const res = await GET(req('', { 'x-cron-secret': 'wrong' }))
    expect(res.status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('401s when the server has no secret configured, even with a matching header', async () => {
    vi.mocked(env).BOT_RUNNER_SECRET = ''
    const res = await GET(req('', { 'x-cron-secret': '' }))
    expect(res.status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
    vi.mocked(env).BOT_RUNNER_SECRET = 'test-secret'
  })

  it('200s with the summary on a normal sweep', async () => {
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, ...okSummary })
  })

  it('502s when the OpenRouter key was rejected — a dead key must go red, not print a green no-op', async () => {
    // Even a sweep that produced data (Bedrock carried it) is 502: docs/LASSO.md §9.
    sweep.mockResolvedValue({ ...okSummary, written: 3, unauthorized: true })
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body.unauthorized).toBe(true)
  })

  it('200s when dormant — no credentials at all is a deliberate state, not a breakage', async () => {
    sweep.mockResolvedValue({ considered: 0, written: 0, skipped: 0, failed: 0, dryRun: 0, dormant: true })
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, dormant: true })
  })

  it('passes ?dryRun=1 through; anything else is not a dry run', async () => {
    await GET(req('?dryRun=1'))
    expect(sweep).toHaveBeenLastCalledWith({ dryRun: true, limit: undefined })
    await GET(req('?dryRun=true'))
    expect(sweep).toHaveBeenLastCalledWith({ dryRun: false, limit: undefined })
    await GET(req())
    expect(sweep).toHaveBeenLastCalledWith({ dryRun: false, limit: undefined })
  })

  it('passes a positive integer ?limit through, rejecting zero, negatives, fractions and junk', async () => {
    await GET(req('?limit=5'))
    expect(sweep).toHaveBeenLastCalledWith({ dryRun: false, limit: 5 })
    for (const bad of ['0', '-3', '2.5', 'abc', '']) {
      await GET(req(`?limit=${bad}`))
      expect(sweep).toHaveBeenLastCalledWith({ dryRun: false, limit: undefined })
    }
  })

  it('propagates a sweep failure (Next turns it into a 500, which fails the workflow)', async () => {
    sweep.mockRejectedValue(new Error('db down'))
    await expect(GET(req())).rejects.toThrow('db down')
  })
})
