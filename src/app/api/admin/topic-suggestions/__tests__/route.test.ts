import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/services/topic-suggestions/suggest', () => ({
  SUGGEST_DEFAULTS: { days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 },
  findTopicSuggestions: vi.fn(),
}))

import { findTopicSuggestions } from '@/lib/services/topic-suggestions/suggest'
import { POST } from '../route'

function req(body: unknown, headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/admin/topic-suggestions', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/admin/topic-suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findTopicSuggestions).mockResolvedValue({ suggestions: [] } as never)
  })

  it('runs the weekly defaults on an empty body', async () => {
    const res = await POST(req(undefined))
    expect(res.status).toBe(200)
    expect(findTopicSuggestions).toHaveBeenCalledWith({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 })
  })

  it('passes overrides through', async () => {
    await POST(req({ days: 3, maxClusters: 20 }))
    expect(findTopicSuggestions).toHaveBeenCalledWith({ days: 3, threshold: 0.88, minSources: 2, maxClusters: 20 })
  })

  it('refuses a caller with neither the cron secret nor an admin session', async () => {
    const res = await POST(req({}, {}))
    expect(res.status).toBe(401)
    expect(findTopicSuggestions).not.toHaveBeenCalled()
  })

  it('refuses a wrong cron secret', async () => {
    const res = await POST(req({}, { 'x-cron-secret': 'nope' }))
    expect(res.status).toBe(401)
    expect(findTopicSuggestions).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range threshold', async () => {
    const res = await POST(req({ threshold: 0.5 }))
    expect(res.status).toBe(400)
  })
})
