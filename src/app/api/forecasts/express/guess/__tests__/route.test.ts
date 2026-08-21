import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockAuth, mockGetOracleProbability, mockGuessChances } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetOracleProbability: vi.fn(),
  mockGuessChances: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))

vi.mock('@/lib/services/oracle', () => ({
  getOracleProbability: mockGetOracleProbability,
  INTERACTIVE_FORECAST_TIMEOUT_MS: 12_000,
}))

vi.mock('@/lib/llm/expressPrediction', () => ({
  guessChances: mockGuessChances,
}))

import { POST } from '../route'
import { NextRequest } from 'next/server'
import { resetRateLimitStore } from '@/lib/rate-limit'

const FAKE_USER = { id: 'user-1', email: 'u@x', name: 'U', role: 'USER' }

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/forecasts/express/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function callPOST(req: NextRequest): Promise<Response> {
  return POST(req, { params: Promise.resolve({}) }) as Promise<Response>
}

describe('POST /api/forecasts/express/guess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitStore()
    mockAuth.mockResolvedValue({ user: FAKE_USER })
    process.env.GEMINI_API_KEY = 'test-key'
  })

  it('passes marketProbability through to guessChances when Oracle has no answer', async () => {
    mockGetOracleProbability.mockResolvedValue(null)
    mockGuessChances.mockResolvedValue({ probability: 70, reasoning: 'Market-informed estimate.' })

    const res = await callPOST(makeRequest({
      claimText: 'X will happen',
      detailsText: '',
      articles: [],
      marketProbability: 62,
    }))

    expect(res.status).toBe(200)
    expect(mockGuessChances).toHaveBeenCalledWith('X will happen', '', [], 62)
  })

  it('omits marketProbability when the client sends none', async () => {
    mockGetOracleProbability.mockResolvedValue(null)
    mockGuessChances.mockResolvedValue({ probability: 50, reasoning: 'No prior.' })

    await callPOST(makeRequest({ claimText: 'X will happen', detailsText: '', articles: [] }))

    expect(mockGuessChances).toHaveBeenCalledWith('X will happen', '', [], undefined)
  })

  it('short-circuits on an Oracle answer without calling guessChances', async () => {
    mockGetOracleProbability.mockResolvedValue(0.81)

    const res = await callPOST(makeRequest({
      claimText: 'X will happen',
      detailsText: '',
      articles: [],
      marketProbability: 62,
    }))
    const body = await res.json()

    expect(body.probability).toBe(81)
    expect(mockGuessChances).not.toHaveBeenCalled()
  })
})
