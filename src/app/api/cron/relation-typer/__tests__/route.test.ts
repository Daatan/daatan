import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/lib/services/relation-typer', () => ({ runRelationTyper: vi.fn() }))

import { runRelationTyper } from '@/lib/services/relation-typer'
import { GET } from '../route'

const run = vi.mocked(runRelationTyper)
const req = (url = 'http://localhost/api/cron/relation-typer', headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) =>
  new NextRequest(url, { headers })

describe('GET /api/cron/relation-typer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    run.mockResolvedValue({
      version: 'v1', candidates: 0, typed: 0, independent: 0, lowConfidence: 0, failed: 0,
      outcomes: { created: 0, refreshed: 0, kept_rejected: 0, kept_decided: 0, self: 0 }, dryRun: false,
    })
  })

  it('401s without the cron secret, running nothing', async () => {
    const res = await GET(req(undefined, {}))
    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('passes dryRun and a capped limit through', async () => {
    const res = await GET(req('http://localhost/api/cron/relation-typer?dryRun=1&limit=999'))
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith({ limit: 200, dryRun: true })
  })

  it('500s when the run throws — a silent green is the failure mode', async () => {
    run.mockRejectedValueOnce(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
