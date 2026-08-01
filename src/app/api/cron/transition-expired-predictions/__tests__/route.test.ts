import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret' },
}))

vi.mock('@/lib/services/prediction-lifecycle', () => ({
  transitionExpiredPredictions: vi.fn(),
}))

import { transitionExpiredPredictions } from '@/lib/services/prediction-lifecycle'
import { GET } from '../route'

const transition = vi.mocked(transitionExpiredPredictions)

function req(headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/cron/transition-expired-predictions', { headers })
}

describe('GET /api/cron/transition-expired-predictions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transition.mockResolvedValue(0)
  })

  it('401s without the cron secret', async () => {
    const res = await GET(req({}))
    expect(res.status).toBe(401)
    expect(transition).not.toHaveBeenCalled()
  })

  it('401s with a wrong secret', async () => {
    const res = await GET(req({ 'x-cron-secret': 'wrong' }))
    expect(res.status).toBe(401)
    expect(transition).not.toHaveBeenCalled()
  })

  it('transitions expired predictions and returns the count', async () => {
    transition.mockResolvedValue(3)
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, transitioned: 3 })
  })

  it('returns 500 when the transition throws', async () => {
    transition.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
