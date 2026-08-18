import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret' },
}))

vi.mock('@/lib/services/evidence-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/evidence-health')>()
  return { ...actual, checkEvidenceHealth: vi.fn() }
})

vi.mock('@/lib/services/telegram', () => ({
  notifyEvidenceHealthDigest: vi.fn(),
}))

import { env } from '@/env'
import { checkEvidenceHealth } from '@/lib/services/evidence-health'
import { notifyEvidenceHealthDigest } from '@/lib/services/telegram'
import { GET } from '../route'

const check = vi.mocked(checkEvidenceHealth)
const notify = vi.mocked(notifyEvidenceHealthDigest)

function req(headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/cron/evidence-health', { headers })
}

const CLEAN = {
  fired: [],
  suppressed: 0,
  recentRows: 1941,
  recentFailedPct: 32,
  baselineFailedPct: 51,
}

describe('GET /api/cron/evidence-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(env).BOT_RUNNER_SECRET = 'test-secret'
    check.mockResolvedValue(CLEAN)
  })

  it('401s without the cron secret, querying nothing', async () => {
    const res = await GET(req({}))
    expect(res.status).toBe(401)
    expect(check).not.toHaveBeenCalled()
  })

  it('401s with a wrong secret', async () => {
    const res = await GET(req({ 'x-cron-secret': 'wrong' }))
    expect(res.status).toBe(401)
    expect(check).not.toHaveBeenCalled()
  })

  it('401s when the server has no secret configured, even with a matching header', async () => {
    vi.mocked(env).BOT_RUNNER_SECRET = ''
    const res = await GET(req({ 'x-cron-secret': '' }))
    expect(res.status).toBe(401)
    expect(check).not.toHaveBeenCalled()
  })

  it('reports the windows alongside the rates, so a bare rate is never read out of context', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      recentDays: 7,
      baselineDays: 28,
      recentRows: 1941,
      recentFailedPct: 32,
      baselineFailedPct: 51,
      suppressed: 0,
      fired: [],
    })
  })

  it('hands the digest exactly what fired, keyed for the workflow log', async () => {
    check.mockResolvedValue({
      ...CLEAN,
      suppressed: 2,
      fired: [
        { kind: 'source_silent', source: 'bbc.co.uk', baselineRows: 42 },
        { kind: 'overall_failure_rate', recentPct: 66, baselinePct: 47 },
      ],
    })

    const res = await GET(req())

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recentDays: 7,
        baselineDays: 28,
        suppressed: 2,
        issues: [
          { kind: 'source_silent', source: 'bbc.co.uk', baselineRows: 42 },
          { kind: 'overall_failure_rate', recentPct: 66, baselinePct: 47 },
        ],
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      fired: ['source-silent:bbc.co.uk', 'overall-failure'],
    })
  })

  it('500s when the check itself fails, rather than returning a green run', async () => {
    check.mockRejectedValue(new Error('connection terminated'))

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect(notify).not.toHaveBeenCalled()
  })
})
