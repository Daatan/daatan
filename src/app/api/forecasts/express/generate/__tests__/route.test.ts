import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockAuth, mockGenerateExpress, mockCreateAttempt } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGenerateExpress: vi.fn(),
  mockCreateAttempt: vi.fn().mockResolvedValue({ id: 'attempt-1' }),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))

vi.mock('@/lib/llm/expressPrediction', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm/expressPrediction')>('@/lib/llm/expressPrediction')
  return {
    ...actual,
    generateExpressPrediction: mockGenerateExpress,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    forecastCreationAttempt: {
      create: mockCreateAttempt,
    },
  },
}))

import { POST } from '../route'
import { NoArticlesFoundError } from '@/lib/llm/expressPrediction'
import { NextRequest } from 'next/server'
import { resetRateLimitStore } from '@/lib/rate-limit'

const FAKE_USER = { id: 'user-1', email: 'u@x', name: 'U', role: 'USER' }

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/forecasts/express/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function callPOST(req: NextRequest): Promise<Response> {
  return POST(req, { params: Promise.resolve({}) }) as Promise<Response>
}

async function consumeStream(response: Response): Promise<string[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value))
  }
  return chunks.join('').split('\n').filter(Boolean)
}

describe('POST /api/forecasts/express/generate — attempt persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitStore()
    mockAuth.mockResolvedValue({ user: FAKE_USER })
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.SERPER_API_KEY = 'test-key'
    mockCreateAttempt.mockResolvedValue({ id: 'attempt-1' })
  })

  it('records SUCCESS attempt when generation completes', async () => {
    mockGenerateExpress.mockResolvedValue({ claimText: 'X', resolveByDatetime: '2027-01-01' })
    const res = await callPOST(makeRequest({ userInput: 'Bitcoin will reach $100k' }))
    await consumeStream(res)

    expect(mockCreateAttempt).toHaveBeenCalledTimes(1)
    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          outcome: 'SUCCESS',
          isUrl: false,
        }),
      }),
    )
  })

  it('records NO_ARTICLES attempt with searchedFor + isNonLatin in details', async () => {
    mockGenerateExpress.mockRejectedValue(
      new NoArticlesFoundError({ searchedFor: 'кто-то', isUrl: false, isNonLatin: true }),
    )
    const res = await callPOST(makeRequest({ userInput: 'кто-то' }))
    await consumeStream(res)

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'NO_ARTICLES',
          details: expect.objectContaining({ searchedFor: 'кто-то', isNonLatin: true }),
        }),
      }),
    )
  })

  it('records MODERATED attempt when content is offensive', async () => {
    mockGenerateExpress.mockRejectedValue(new Error('OFFENSIVE_INPUT: vulgar language detected'))
    const res = await callPOST(makeRequest({ userInput: 'some offensive text' }))
    await consumeStream(res)

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'MODERATED',
          details: { moderationReason: 'vulgar language detected' },
        }),
      }),
    )
  })

  it('records SEARCH_UNAVAILABLE with HTTP status code in details', async () => {
    mockGenerateExpress.mockRejectedValue(new Error('Search API error: 429 Too Many Requests'))
    const res = await callPOST(makeRequest({ userInput: 'something normal' }))
    await consumeStream(res)

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'SEARCH_UNAVAILABLE',
          details: { searchErrorCode: 429 },
        }),
      }),
    )
  })

  it('records GENERATION_FAILED for unexpected errors', async () => {
    mockGenerateExpress.mockRejectedValue(new Error('something else broke'))
    const res = await callPOST(makeRequest({ userInput: 'something normal' }))
    await consumeStream(res)

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'GENERATION_FAILED',
          details: { errorMessage: 'something else broke' },
        }),
      }),
    )
  })

  it('marks isUrl=true for URL inputs', async () => {
    mockGenerateExpress.mockResolvedValue({ claimText: 'X' })
    const res = await callPOST(makeRequest({ userInput: 'https://example.com/article' }))
    await consumeStream(res)

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isUrl: true }),
      }),
    )
  })

  it('truncates userInput to 1000 chars in the audit row', async () => {
    mockGenerateExpress.mockResolvedValue({ claimText: 'X' })
    const longInput = 'A'.repeat(900) + 'BBBB' // pass zod min/max
    const res = await callPOST(makeRequest({ userInput: longInput }))
    await consumeStream(res)

    const callArg = mockCreateAttempt.mock.calls[0][0]
    expect(callArg.data.userInput.length).toBeLessThanOrEqual(1000)
  })
})
