import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret', TEMPORAL_CLOCK_DISABLED: undefined },
}))

vi.mock('@/lib/services/temporal-clock', () => ({
  runRequote: vi.fn(),
}))

import { env } from '@/env'
import { runRequote } from '@/lib/services/temporal-clock'
import { POST } from '../route'

const run = vi.mocked(runRequote)

function req(body: unknown, headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/cron/requote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const emptySummary = {
  examined: 0, glided: 0, pinned: 0, provisionalPins: 0, unchanged: 0,
  skippedNoAnchor: 0, skippedTeffBeforeAnchor: 0, selfHealed: 0,
  divergenceAlerts: 0, deadlineAlerts: 0, provisionalAlerts: 0, errors: 0, deltas: [],
}

describe('POST /api/cron/requote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    run.mockResolvedValue(emptySummary)
  })

  it('401s without the cron secret', async () => {
    const res = await POST(req({}, {}))
    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('401s with a wrong secret', async () => {
    const res = await POST(req({}, { 'x-cron-secret': 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('passes archetypes through from the body, lowercased', async () => {
    await POST(req({ archetypes: ['DIFFUSE'] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ archetypes: ['diffuse'] }))
  })

  it('defaults to ["diffuse"] when the body has no archetypes', async () => {
    await POST(req({}))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ archetypes: ['diffuse'] }))
  })

  it('passes dryRun through', async () => {
    await POST(req({ dryRun: true }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
  })

  it('respects the TEMPORAL_CLOCK_DISABLED kill switch, returning 200 without calling runRequote', async () => {
    vi.mocked(env).TEMPORAL_CLOCK_DISABLED = 'true'
    const res = await POST(req({ archetypes: ['diffuse'] }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.disabled).toBe(true)
    expect(run).not.toHaveBeenCalled()
    vi.mocked(env).TEMPORAL_CLOCK_DISABLED = undefined
  })

  it('returns the summary on success', async () => {
    run.mockResolvedValue({ ...emptySummary, glided: 3 })
    const res = await POST(req({}))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.glided).toBe(3)
  })

  it('500s and logs when runRequote throws', async () => {
    run.mockRejectedValue(new Error('db down'))
    const res = await POST(req({}))
    expect(res.status).toBe(500)
  })
})
