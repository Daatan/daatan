import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/forecasts/[id]/context/route'

// Mock session/auth
const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: mockAuth }))

const { mockOracleSearch, mockGenerateContent, mockPrisma, mockGetOracleForecast, mockRecordOracleFallback } = vi.hoisted(() => ({
  mockOracleSearch: vi.fn(),
  mockGenerateContent: vi.fn(),
  mockGetOracleForecast: vi.fn().mockResolvedValue({ forecast: null, logId: null }),
  mockRecordOracleFallback: vi.fn().mockResolvedValue(undefined),
  mockPrisma: {
    prediction: {
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    contextSnapshot: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    contextTiming: {
      create: vi.fn().mockResolvedValue({}),
    },
    predictionTranslation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/oracle', () => ({
  DEFAULT_MAX_ARTICLES: 30,
  getOracleForecast: (...args: unknown[]) => mockGetOracleForecast(...args),
  recordOracleFallback: (...args: unknown[]) => mockRecordOracleFallback(...args),
}))

vi.mock('@/lib/services/oracleSearch', () => ({
  oracleSearch: (...args: unknown[]) => mockOracleSearch(...args),
}))

vi.mock('@/lib/llm', () => ({
  llmService: {
    generateContent: (...args: unknown[]) => mockGenerateContent(...args),
  },
}))

// Query extraction is covered by its own unit test; here it's a pass-through so
// the route searches with the claim text and the generateContent mocks line up.
vi.mock('@/lib/llm/searchQuery', () => ({
  buildSearchQuery: (claim: string) => Promise.resolve(claim),
}))

vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn().mockResolvedValue('Mock template: {{claimText}} {{changeInstruction}} {{articlesText}}'),
  fillPrompt: vi.fn().mockImplementation((t, v) => Object.values(v).join(' ')),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

const makeRequest = (id: string, method = 'GET') =>
  new NextRequest(`http://localhost/api/forecasts/${id}/context`, { method })

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/forecasts/[id]/context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when prediction not found', async () => {
    mockPrisma.prediction.findFirst.mockResolvedValue(null)

    const res = await GET(makeRequest('missing'), routeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns context timeline', async () => {
    const snapshots = [
      { id: 's1', summary: 'Latest update', sources: [{ title: 'Reuters', url: 'https://r.com' }], createdAt: new Date() },
      { id: 's2', summary: 'Older update', sources: [], createdAt: new Date(Date.now() - 86400000) },
    ]

    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      detailsText: 'Latest update',
      contextUpdatedAt: new Date(),
      contextSnapshots: snapshots,
    })

    const res = await GET(makeRequest('pred1'), routeParams('pred1'))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.currentContext).toBe('Latest update')
    expect(data.snapshots).toHaveLength(2)
    expect(data.contextUpdatedAt).toBeDefined()
  })
})

describe('POST /api/forecasts/[id]/context', () => {
  const authenticatedUser = {
    id: 'user1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'USER',
    rs: 100,
  }

  // Drains an SSE streaming response and merges all events into one object.
  // Error-path tests still use res.json(); this helper is only for success paths.
  async function parseSSE(res: Response): Promise<Record<string, unknown>> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const merged: Record<string, unknown> = {}
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try { Object.assign(merged, JSON.parse(line.slice(6))) } catch { /* ignore */ }
      }
    }
    return merged
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when prediction not found', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue(null)

    const res = await POST(makeRequest('missing', 'POST'), routeParams('missing'))
    expect(res.status).toBe(404)
  })

it('returns 400 when prediction is not ACTIVE', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'RESOLVED_CORRECT',
      contextUpdatedAt: null,
    })

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(400)
  })

  it('returns 429 when rate limited (updated within 1h)', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      contextUpdatedAt: new Date(), // just now
    })

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(429)
  })

  it('returns 429 when user daily limit reached (10 updates/day)', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Test claim',
      contextUpdatedAt: null,
      newsAnchor: null,
    })
    mockPrisma.prediction.count.mockResolvedValueOnce(10)

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.error).toMatch(/daily/i)
  })

  it('returns 503 when no articles found', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Test claim',
      contextUpdatedAt: null,
      newsAnchor: null,
    })
    mockOracleSearch.mockResolvedValue([])

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(503)
  })

  it('returns 503 (not 500) when all search providers fail', async () => {
    // Regression: searchArticles throws "Search API not available" when every provider
    // in the fallback chain fails (transient DDG ECONNRESET, misconfigured keys, etc.).
    // The route must convert that into a clean 503, not leak a 500.
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Test claim',
      contextUpdatedAt: null,
      newsAnchor: null,
    })
    mockOracleSearch.mockRejectedValue(new Error('Search API not available'))

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.error).toMatch(/no recent articles/i)
  })

  it('creates snapshot and updates prediction on success', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Bitcoin will reach $100k',
      detailsText: 'Old context',
      contextUpdatedAt: null,
      newsAnchor: { title: 'Bitcoin Rally' },
    })

    mockOracleSearch.mockResolvedValue([
      { title: 'Bitcoin at 95k', url: 'https://example.com/1', source: 'Reuters', publishedDate: '2026-02-20', snippet: 'Bitcoin surges.' },
    ])

    const snapshot = { id: 'snap1', summary: 'New context summary', sources: [{ title: 'Bitcoin at 95k', url: 'https://example.com/1', source: 'Reuters', publishedDate: '2026-02-20' }], createdAt: new Date() }
    mockGenerateContent.mockResolvedValue({ text: ' New context summary ' })
    mockPrisma.$transaction.mockResolvedValue([snapshot, {}])
    mockPrisma.contextSnapshot.findMany.mockResolvedValue([snapshot])

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(200)

    const data = await parseSSE(res)
    expect(data.success).toBe(true)
    expect(data.newContext).toBe('New context summary')
    expect((data.snapshot as { id: string }).id).toBe('snap1')
    expect((data.timeline as unknown[]).length).toBe(1)

    // Verify transaction was called
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)

    // Verify search used claimText (not newsAnchor title)
    expect(mockOracleSearch).toHaveBeenCalledWith('Bitcoin will reach $100k', 30, undefined, expect.objectContaining({ source: 'context-update' }))
  })

  it('denormalizes Oracle CI bounds onto Prediction when Oracle path runs', async () => {
    // Guards the list-card rendering path: cards read aiCiLow/aiCiHigh directly
    // from Prediction (no ContextSnapshot join), so the route must persist them.
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Bitcoin will reach $100k',
      detailsText: null,
      contextUpdatedAt: null,
      newsAnchor: null,
    })
    mockOracleSearch.mockResolvedValue([
      { title: 'BTC', url: 'https://example.com/1', source: 'Reuters', publishedDate: '2026-02-20', snippet: '.' },
    ])
    mockGenerateContent.mockResolvedValue({ text: 'Summary' })
    // Oracle returns stance in [-1, 1]; route maps to percent via (v+1)/2 * 100
    mockGetOracleForecast.mockResolvedValueOnce({
      forecast: {
        question: 'Bitcoin will reach $100k',
        mean: 0.2,      // → 60%
        std: 0.1,
        ci_low: 0.0,    // → 50%
        ci_high: 0.4,   // → 70%
        articles_used: 3,
        sources: [],
        placeholder: false,
      },
      logId: 'log-1',
    })
    mockPrisma.$transaction.mockResolvedValue([{ id: 'snap1', summary: 'Summary', sources: [], createdAt: new Date() }, {}])
    mockPrisma.contextSnapshot.findMany.mockResolvedValue([])

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(200)
    await parseSSE(res)  // drain stream so DB ops complete before checking mocks

    // Inspect the prediction.update call inside the transaction
    const ops = mockPrisma.$transaction.mock.calls[0][0] as unknown[]
    // ops[1] is the prediction.update invocation — grab its args from the mock
    const predictionUpdateCall = mockPrisma.prediction.update.mock.calls[0][0]
    expect(predictionUpdateCall.data.confidence).toBe(60)
    expect(predictionUpdateCall.data.aiCiLow).toBe(50)
    expect(predictionUpdateCall.data.aiCiHigh).toBe(70)
    // ops: contextSnapshot.create, prediction.update, predictionTranslation.deleteMany
    expect(ops).toHaveLength(3)
  })

  it('clears aiCiLow/aiCiHigh on LLM-fallback path (no Oracle CI available)', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Test',
      detailsText: null,
      contextUpdatedAt: null,
      newsAnchor: null,
    })
    mockOracleSearch.mockResolvedValue([
      { title: 'N', url: 'https://example.com', source: 'X', publishedDate: '2026-02-20', snippet: '.' },
    ])
    mockGenerateContent.mockResolvedValue({ text: 'Summary' })
    mockGetOracleForecast.mockResolvedValueOnce({ forecast: null, logId: 'log-1' })
    mockPrisma.$transaction.mockResolvedValue([{ id: 'snap1', summary: 'Summary', sources: [], createdAt: new Date() }, {}])
    mockPrisma.contextSnapshot.findMany.mockResolvedValue([])

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    await parseSSE(res)

    const predictionUpdateCall = mockPrisma.prediction.update.mock.calls[0][0]
    expect(predictionUpdateCall.data.aiCiLow).toBeNull()
    expect(predictionUpdateCall.data.aiCiHigh).toBeNull()
  })

  it('passes previousContext to LLM prompt when detailsText exists', async () => {
    mockAuth.mockResolvedValue({ user: authenticatedUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'user1',
      status: 'ACTIVE',
      claimText: 'Test claim',
      detailsText: 'Previous context here',
      contextUpdatedAt: null,
      newsAnchor: null,
    })

    mockOracleSearch.mockResolvedValue([
      { title: 'News', url: 'https://example.com', source: 'BBC', publishedDate: '2026-02-20', snippet: 'Something happened.' },
    ])

    mockGenerateContent.mockResolvedValue({ text: 'Updated context' })
    mockPrisma.$transaction.mockResolvedValue([{ id: 'snap1', summary: 'Updated context', sources: [], createdAt: new Date() }, {}])
    mockPrisma.contextSnapshot.findMany.mockResolvedValue([])

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    await parseSSE(res)

    // Verify LLM was called with a prompt containing previous context
    const llmCall = mockGenerateContent.mock.calls[0][0]
    expect(llmCall.prompt).toContain('Previous context here')
    expect(llmCall.prompt).toContain('CHANGED')
  })

  it('allows ADMIN to update context for other user predictions', async () => {
    const adminUser = { ...authenticatedUser, id: 'admin1', role: 'ADMIN' }
    mockAuth.mockResolvedValue({ user: adminUser })
    mockPrisma.prediction.findFirst.mockResolvedValue({
      id: 'pred1',
      authorId: 'other-user',
      status: 'ACTIVE',
      claimText: 'Test',
      detailsText: null,
      contextUpdatedAt: null,
      newsAnchor: null,
    })

    mockOracleSearch.mockResolvedValue([
      { title: 'News', url: 'https://example.com', source: 'BBC', publishedDate: '2026-02-20', snippet: 'News.' },
    ])

    mockGenerateContent.mockResolvedValue({ text: 'Context' })
    mockPrisma.$transaction.mockResolvedValue([{ id: 'snap1', summary: 'Context', sources: [], createdAt: new Date() }, {}])
    mockPrisma.contextSnapshot.findMany.mockResolvedValue([])

    const res = await POST(makeRequest('pred1', 'POST'), routeParams('pred1'))
    expect(res.status).toBe(200)
    await parseSSE(res)
  })
})
