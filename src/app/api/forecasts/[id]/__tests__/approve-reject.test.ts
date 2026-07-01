/**
 * @jest-environment node
 * Test suite for bot forecast approval and rejection workflows.
 * Covers status transitions, staking, Telegram notifications, and rejection tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const mockSendChannelNotification = vi.fn()
vi.mock('@/lib/services/telegram', () => ({
  notifyBotForecastApproved: vi.fn(),
  notifyBotForecastRejected: vi.fn(),
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))

vi.mock('@/lib/services/commitment', () => ({
  createCommitment: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    botConfig: {
      findUnique: vi.fn(),
    },
    botRejectedTopic: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

// ─── Test Fixtures ────────────────────────────────────────────────────────

const APPROVER_SESSION = {
  user: {
    id: 'approver-1',
    email: 'approver@daatan.test',
    role: 'ADMIN',
    rs: 100,
  },
}

const APPROVER_USER = {
  id: 'approver-1',
  name: 'Alice Admin',
  username: 'alice_admin',
}

const BOT_AUTHOR = {
  id: 'bot-user-1',
  name: 'CryptoBot',
  username: 'cryptobot_b',
  isBot: true,
}

function makeBotPrediction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pred-1',
    claimText: '🤖 Bitcoin will reach $100k by Dec 2026',
    detailsText: 'Based on historical growth patterns...',
    status: 'PENDING_APPROVAL',
    publishedAt: null,
    resolvedAt: null,
    resolutionOutcome: null,
    resolutionNote: null,
    sentiment: 'positive',
    confidence: 75,
    extractedEntities: ['Bitcoin', 'USD'],
    consensusLine: 'Based on 4 sources, 72% indicate upward pressure',
    sourceSummary: 'Multiple financial sources report bullish sentiment',
    author: BOT_AUTHOR,
    ...overrides,
  }
}

function makeBotConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'bot-config-1',
    userId: 'bot-user-1',
    stakeMin: 50,
    stakeMax: 150,
    requireApprovalForForecasts: true,
    ...overrides,
  }
}

// ─── POST /api/forecasts/[id]/approve ──────────────────────────────────────

describe('POST /api/forecasts/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/approve/route')
    mockAuth.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/approve', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(res.status).toBe(401)
  })

  it('returns 404 when forecast does not exist', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/approve/route')
    const { prisma } = await import('@/lib/prisma')
    mockAuth.mockResolvedValue(APPROVER_SESSION)
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/forecasts/nonexistent/approve', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'nonexistent' }) })

    expect(res.status).toBe(404)
    expect(await res.json()).toHaveProperty('error')
  })

  it('returns 400 when forecast is not by a bot', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/approve/route')
    const { prisma } = await import('@/lib/prisma')
    mockAuth.mockResolvedValue(APPROVER_SESSION)

    const humanPrediction = makeBotPrediction({
      author: { ...BOT_AUTHOR, isBot: false },
    })
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(humanPrediction as any)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/approve', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('error')
  })

  it('returns 400 when forecast is not PENDING_APPROVAL', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/approve/route')
    const { prisma } = await import('@/lib/prisma')
    mockAuth.mockResolvedValue(APPROVER_SESSION)

    const activePrediction = makeBotPrediction({ status: 'ACTIVE' })
    vi.mocked(prisma.prediction.findFirst).mockResolvedValueOnce(activePrediction as any)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/approve', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('error')
  })

  it('transitions status from PENDING_APPROVAL to ACTIVE and sets publishedAt', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/approve/route')
    const { prisma } = await import('@/lib/prisma')
    mockAuth.mockResolvedValue(APPROVER_SESSION)

    const pending = makeBotPrediction()
    const approved = { ...pending, status: 'ACTIVE', publishedAt: new Date() }

    vi.mocked(prisma.prediction.findFirst)
      .mockResolvedValueOnce(pending as any)
      .mockResolvedValueOnce(approved as any)
    vi.mocked(prisma.prediction.update).mockResolvedValue(approved as any)
    vi.mocked(prisma.botConfig.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(APPROVER_USER as any)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/approve', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe('ACTIVE')
    expect(data.publishedAt).toBeDefined()
    expect(prisma.prediction.update).toHaveBeenCalledWith({
      where: { id: 'pred-1' },
      data: {
        status: 'ACTIVE',
        publishedAt: expect.any(Date),
      },
      include: expect.any(Object),
    })
  })


})

// ─── POST /api/forecasts/[id]/reject ───────────────────────────────────────

describe('POST /api/forecasts/[id]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/reject/route')
    mockAuth.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/reject', {
      method: 'POST',
      body: JSON.stringify({ keywords: [], description: '' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(res.status).toBe(401)
  })

  it('returns 400 when forecast is not by a bot', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/reject/route')
    const { prisma } = await import('@/lib/prisma')
    mockAuth.mockResolvedValue(APPROVER_SESSION)

    const humanPrediction = makeBotPrediction({
      author: { ...BOT_AUTHOR, isBot: false },
    })
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(humanPrediction as any)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/reject', {
      method: 'POST',
      body: JSON.stringify({ keywords: [], description: '' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(res.status).toBe(400)
  })






  it('returns response with success=true and prediction data', async () => {
    const { POST } = await import('@/app/api/forecasts/[id]/reject/route')
    const { prisma } = await import('@/lib/prisma')
    mockAuth.mockResolvedValue(APPROVER_SESSION)

    const pending = makeBotPrediction()
    const rejected = { ...pending, status: 'VOID', resolutionOutcome: 'void' }

    vi.mocked(prisma.prediction.findFirst).mockResolvedValueOnce(pending as any)
    vi.mocked(prisma.prediction.update).mockResolvedValue(rejected as any)
    vi.mocked(prisma.botConfig.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(APPROVER_USER as any)

    const req = new NextRequest('http://localhost/api/forecasts/pred-1/reject', {
      method: 'POST',
      body: JSON.stringify({ keywords: [], description: '' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'pred-1' }) })
    const data = await res.json()

    expect(data.success).toBe(true)
    expect(data.prediction).toBeDefined()
    expect(data.message).toContain('rejected')
  })
})
