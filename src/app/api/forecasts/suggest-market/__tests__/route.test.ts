import { vi } from 'vitest'

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))
vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/services/external-markets', () => ({ suggestMarketMatch: vi.fn() }))

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { suggestMarketMatch } from '@/lib/services/external-markets'

const ctx = { params: Promise.resolve({}) }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/forecasts/suggest-market', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/forecasts/suggest-market', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
  })

  it('returns the match when one is found', async () => {
    vi.mocked(suggestMarketMatch).mockResolvedValue({
      externalMarketId: 'm1',
      provider: 'POLYMARKET',
      providerLabel: 'Polymarket',
      question: 'Will X happen?',
      yesProbability: 68,
      url: 'https://polymarket.com/event/x',
      score: 91,
    } as never)

    const res = await POST(req({ claimText: 'Will X happen this year?' }), ctx as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.match.externalMarketId).toBe('m1')
    expect(data.match.score).toBe(91)
  })

  it('returns { match: null } when nothing is similar enough', async () => {
    vi.mocked(suggestMarketMatch).mockResolvedValue(null)
    const res = await POST(req({ claimText: 'Something unrelated entirely' }), ctx as never)
    expect(res.status).toBe(200)
    expect((await res.json()).match).toBeNull()
  })

  it('rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req({ claimText: 'Will X happen?' }), ctx as never)
    expect(res.status).toBe(401)
  })

  it('forwards a provided deadline to the matcher as a Date', async () => {
    vi.mocked(suggestMarketMatch).mockResolvedValue(null)
    await POST(req({ claimText: 'Will X happen this year?', deadline: '2026-12-31T00:00:00.000Z' }), ctx as never)
    expect(suggestMarketMatch).toHaveBeenCalledWith(
      'Will X happen this year?',
      new Date('2026-12-31T00:00:00.000Z'),
    )
  })

  it('passes null when no deadline is provided', async () => {
    vi.mocked(suggestMarketMatch).mockResolvedValue(null)
    await POST(req({ claimText: 'Will X happen this year?' }), ctx as never)
    expect(suggestMarketMatch).toHaveBeenCalledWith('Will X happen this year?', null)
  })
})
