import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Defense-in-depth: AI/market API routes must short-circuit (404) when the
 * capability is off, before touching any LLM/Oracle/market dependency. We mock
 * withAuth to invoke the handler directly with a fake user, and toggle the
 * capability mock.
 */

const caps = { ai: true, externalMarkets: true }
vi.mock('@/lib/capabilities', () => ({
  aiFeaturesEnabled: () => caps.ai,
  externalMarketsEnabled: () => caps.externalMarkets,
}))

vi.mock('@/lib/api-middleware', () => ({
  withAuth: (handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest) => handler(req, { id: 'u1' }, { params: {} }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetAt: 0 }),
  rateLimitResponse: vi.fn(),
}))

// Heavy leaf deps that must NOT be reached when the gate is off.
const suggestTags = vi.fn()
vi.mock('@/lib/llm/gemini', () => ({ suggestTags, extractPrediction: vi.fn() }))
const suggestMarketMatch = vi.fn()
vi.mock('@/lib/services/external-markets', () => ({
  suggestMarketMatch,
  getProviderForUrl: vi.fn(),
  resolveMarketByUrl: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

function post(body: unknown = {}) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
}

const ctx = { params: Promise.resolve({}) }

describe('AI/market route capability guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    caps.ai = true
    caps.externalMarkets = true
  })

  it('suggest-tags returns 404 when AI is off, without calling the LLM', async () => {
    caps.ai = false
    const { POST } = await import('@/app/api/ai/suggest-tags/route')
    const res = await POST(post({ claim: 'something long enough to suggest' }), ctx)
    expect(res.status).toBe(404)
    expect(suggestTags).not.toHaveBeenCalled()
  })

  it('suggest-market returns an empty match when external markets are off', async () => {
    caps.externalMarkets = false
    const { POST } = await import('@/app/api/forecasts/suggest-market/route')
    const res = await POST(post({ claimText: 'will X happen' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ match: null })
    expect(suggestMarketMatch).not.toHaveBeenCalled()
  })
})
