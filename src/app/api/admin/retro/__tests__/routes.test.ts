import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/services/retro-generator/candidates', () => ({
  CANDIDATE_DEFAULTS: { days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 },
  findRetroCandidates: vi.fn(),
}))
vi.mock('@/lib/services/retro-generator/simulate', () => ({ simulateRetroEvent: vi.fn() }))

import { findRetroCandidates } from '@/lib/services/retro-generator/candidates'
import { simulateRetroEvent } from '@/lib/services/retro-generator/simulate'
import { POST as candidates } from '../candidates/route'
import { POST as simulate } from '../simulate/route'

function req(path: string, body: unknown, headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest(`http://localhost/api/admin/retro/${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const candidate = {
  reports: [
    { url: 'https://a.com/1', source: 'a.com', publishedDate: '2026-11-10', claim: 'c1', quote: null },
    { url: 'https://b.com/2', source: 'b.com', publishedDate: '2026-11-11', claim: 'c2', quote: null },
  ],
  event: { summary: 's', date: '2026-11-10', url: 'https://b.com/2' },
  claimTemplate: 'X by {DEADLINE}.',
  rulesTemplate: 'YES by {DEADLINE}.',
}

describe('POST /api/admin/retro/candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findRetroCandidates).mockResolvedValue({ candidates: [] } as never)
  })

  it('runs the weekly defaults on an empty body', async () => {
    const res = await candidates(req('candidates', undefined))
    expect(res.status).toBe(200)
    expect(findRetroCandidates).toHaveBeenCalledWith({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 })
  })

  it('refuses a caller with neither the cron secret nor an admin session', async () => {
    const res = await candidates(req('candidates', {}, {}))
    expect(res.status).toBe(401)
    expect(findRetroCandidates).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range threshold', async () => {
    const res = await candidates(req('candidates', { threshold: 0.5 }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/admin/retro/simulate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(simulateRetroEvent).mockResolvedValue({ status: 'skipped', reason: 'thin_evidence' })
  })

  it('is a dry run unless mode is apply', async () => {
    await simulate(req('simulate', candidate))
    expect(vi.mocked(simulateRetroEvent).mock.calls[0][0]).toMatchObject({ dryRun: true })
    await simulate(req('simulate', { ...candidate, mode: 'apply' }))
    expect(vi.mocked(simulateRetroEvent).mock.calls[1][0]).toMatchObject({ dryRun: false })
  })

  it('rejects an event URL that is not one of the reports', async () => {
    const res = await simulate(req('simulate', { ...candidate, event: { ...candidate.event, url: 'https://elsewhere.com' } }))
    expect(res.status).toBe(400)
    expect(simulateRetroEvent).not.toHaveBeenCalled()
  })
})
