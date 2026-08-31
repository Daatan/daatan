import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockAuth, mockGetOraculProbability, mockGuessChances } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetOraculProbability: vi.fn(),
  mockGuessChances: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))

vi.mock('@/lib/services/oracle', () => ({
  getOraculProbability: mockGetOraculProbability,
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

  it('passes marketProbability through to guessChances when Oracul has no answer', async () => {
    mockGetOraculProbability.mockResolvedValue(null)
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
    mockGetOraculProbability.mockResolvedValue(null)
    mockGuessChances.mockResolvedValue({ probability: 50, reasoning: 'No prior.' })

    await callPOST(makeRequest({ claimText: 'X will happen', detailsText: '', articles: [] }))

    expect(mockGuessChances).toHaveBeenCalledWith('X will happen', '', [], undefined)
  })

  it('returns the abstention rather than a substituted number (#1657)', async () => {
    // guess-chances may answer null when the claim is too vague to estimate. The
    // route must pass that through: an invented number would reach the drafter
    // looking exactly like a real suggestion, which is the reason for the abstain
    // contract in the first place. The reasoning says what is missing.
    mockGetOraculProbability.mockResolvedValue(null)
    mockGuessChances.mockResolvedValue({
      probability: null,
      reasoning: 'The claim names no resolution criterion.',
    })

    const res = await callPOST(makeRequest({ claimText: 'X will happen', detailsText: '', articles: [] }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.probability).toBeNull()
    expect(body.reasoning).toBe('The claim names no resolution criterion.')
  })

  it('short-circuits on an Oracul answer without calling guessChances', async () => {
    mockGetOraculProbability.mockResolvedValue(0.81)

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
