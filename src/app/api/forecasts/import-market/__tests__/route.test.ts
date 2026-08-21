import { vi } from 'vitest'

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))
vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/services/external-markets', () => ({
  getProviderForUrl: vi.fn(),
  resolveMarketByUrl: vi.fn(),
  PROVIDER_LABEL: { POLYMARKET: 'Polymarket', KALSHI: 'Kalshi' },
}))

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { getProviderForUrl, resolveMarketByUrl } from '@/lib/services/external-markets'

const ctx = { params: Promise.resolve({}) }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/forecasts/import-market', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/forecasts/import-market', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
  })

  it('returns 422 for an unsupported URL', async () => {
    vi.mocked(getProviderForUrl).mockReturnValue(null)
    const res = await POST(req({ url: 'https://example.com/x' }), ctx as never)
    expect(res.status).toBe(422)
    expect(resolveMarketByUrl).not.toHaveBeenCalled()
  })

  it('returns a prefill payload for a resolvable market', async () => {
    vi.mocked(getProviderForUrl).mockReturnValue({ id: 'POLYMARKET' } as never)
    vi.mocked(resolveMarketByUrl).mockResolvedValue({
      id: 'm1',
      provider: 'POLYMARKET',
      question: 'Will X happen?',
      endDate: new Date('2026-12-31T00:00:00Z'),
      url: 'https://polymarket.com/event/x',
    } as never)

    const res = await POST(req({ url: 'https://polymarket.com/event/x' }), ctx as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toMatchObject({
      externalMarketId: 'm1',
      provider: 'POLYMARKET',
      providerLabel: 'Polymarket',
      claimText: 'Will X happen?',
      url: 'https://polymarket.com/event/x',
    })
    expect(data.resolveByDatetime).toContain('2026-12-31')
  })

  it('returns 422 when the market cannot be resolved', async () => {
    vi.mocked(getProviderForUrl).mockReturnValue({ id: 'POLYMARKET' } as never)
    vi.mocked(resolveMarketByUrl).mockResolvedValue(null)
    const res = await POST(req({ url: 'https://polymarket.com/event/gone' }), ctx as never)
    expect(res.status).toBe(422)
  })

  it('rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req({ url: 'https://polymarket.com/event/x' }), ctx as never)
    expect(res.status).toBe(401)
  })
})
