import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as resolvePrediction } from '@/app/api/forecasts/[id]/resolve/route'

// Mock session/auth
const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: mockAuth }))

vi.mock('@/lib/services/telegram', () => ({
  notifyForecastResolved: vi.fn(),
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))

vi.mock('@/lib/services/notification', () => ({
  createNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    prediction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    predictionOption: {
      update: vi.fn(),
    },
    commitment: {
      update: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        prediction: {
          update: vi.fn().mockResolvedValue({
            id: 'pred-1',
            status: 'RESOLVED_CORRECT',
            resolvedAt: new Date(),
            resolvedById: 'resolver1',
          }),
        },
        predictionOption: { update: vi.fn() },
        commitment: { update: vi.fn() },
        user: { update: vi.fn() },
      })
    ),
  },
}))

describe('POST /api/predictions/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/predictions/pred-1/resolve', {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'correct',
        resolutionNote: 'Test',
      }),
    })

    const response = await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(response.status).toBe(401)
  })

  it('returns 403 when user is not RESOLVER or ADMIN', async () => {
    // withAuth checks role from session — USER role is not in allowed roles
    mockAuth.mockResolvedValue({
      user: { id: 'user1', email: 'user@example.com', role: 'USER' },
    })

    const request = new NextRequest('http://localhost/api/predictions/pred-1/resolve', {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'correct',
        resolutionNote: 'Test',
      }),
    })

    const response = await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toContain('Forbidden')
  })

  it('allows RESOLVER to resolve prediction', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({
      user: { id: 'resolver1', email: 'resolver@example.com', role: 'RESOLVER' },
    })

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      id: 'pred-1',
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      tags: [],
      options: [],
      commitments: [],
    } as never)

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        prediction: { update: vi.fn().mockResolvedValue({ id: 'pred-1', status: 'RESOLVED_CORRECT' }) },
        predictionOption: { update: vi.fn() },
        commitment: { update: vi.fn() },
        user: { update: vi.fn() },
      }
      return fn(tx as never) as never
    })

    const request = new NextRequest('http://localhost/api/predictions/pred-1/resolve', {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'correct',
        resolutionNote: 'Resolution note',
      }),
    })

    const response = await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(response.status).toBe(200)
  })

  it('allows ADMIN to resolve prediction', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({
      user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN' },
    })

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      id: 'pred-1',
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      tags: [],
      options: [],
      commitments: [],
    } as never)

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        prediction: { update: vi.fn().mockResolvedValue({ id: 'pred-1', status: 'RESOLVED_CORRECT' }) },
        predictionOption: { update: vi.fn() },
        commitment: { update: vi.fn() },
        user: { update: vi.fn() },
      }
      return fn(tx as never) as never
    })

    const request = new NextRequest('http://localhost/api/predictions/pred-1/resolve', {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'correct',
        resolutionNote: 'Admin resolution',
      }),
    })

    const response = await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

    expect(response.status).toBe(200)
  })

  it('returns 404 when prediction not found', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({
      user: { id: 'resolver1', email: 'resolver@example.com', role: 'RESOLVER' },
    })

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/predictions/nonexistent/resolve', {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'correct',
        resolutionNote: 'Test',
      }),
    })

    const response = await resolvePrediction(request, { params: Promise.resolve({ id: 'nonexistent' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toContain('not found')
  })

  it('uses params.id for prediction lookup (not URL parsing)', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({
      user: { id: 'resolver1', email: 'resolver@example.com', role: 'RESOLVER' },
    })

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)

    // URL path has a DIFFERENT id than params — params.id should win
    const request = new NextRequest('http://localhost/api/forecasts/wrong-id/resolve', {
      method: 'POST',
      body: JSON.stringify({ outcome: 'correct', resolutionNote: 'Test' }),
    })

    await resolvePrediction(request, { params: Promise.resolve({ id: 'correct-id' }) })

    expect(prisma.prediction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'correct-id' } })
    )
  })

  describe('commitment RS calculations (Brier score)', () => {
    const setupResolveWithCommitments = async (commitments: Array<{
      id: string
      userId: string
      cuCommitted: number
      binaryChoice: boolean | null
      optionId?: string | null
      user: { id: string; rs: number }
    }>) => {
      const { prisma } = await import('@/lib/prisma')

      mockAuth.mockResolvedValue({
        user: { id: 'resolver1', email: 'resolver@example.com', role: 'RESOLVER' },
      })

      vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
        id: 'pred-1',
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        claimText: 'Test prediction',
        slug: 'test-prediction',
        options: [],
        commitments,
      } as never)

      const mockUserUpdate = vi.fn()
      const mockCommitmentUpdate = vi.fn()

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const tx = {
          prediction: { update: vi.fn().mockResolvedValue({ id: 'pred-1', status: 'RESOLVED_CORRECT' }) },
          predictionOption: { update: vi.fn() },
          commitment: { update: mockCommitmentUpdate },
          user: { update: mockUserUpdate },
        }
        return fn(tx as never) as never
      })

      return { mockUserUpdate, mockCommitmentUpdate }
    }

    it('correct BINARY — confidence 20 → p=0.6, Brier ΔRS = +9', async () => {
      // cuCommitted=20 → p = (20+100)/200 = 0.6, outcome=correct → outcomeNumeric=1
      // brierScore = (0.6-1)² = 0.16, rsChange = round((0.25-0.16)*100) = 9
      const { mockCommitmentUpdate, mockUserUpdate } = await setupResolveWithCommitments([{
        id: 'commit-1',
        userId: 'user1',
        cuCommitted: 20,
        binaryChoice: true,
        optionId: null,
        user: { id: 'user1', rs: 100 },
      }])

      const request = new NextRequest('http://localhost/api/forecasts/pred-1/resolve', {
        method: 'POST',
        body: JSON.stringify({ outcome: 'correct', resolutionNote: 'Test' }),
      })

      await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

      expect(mockCommitmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rsChange: 9 }),
        })
      )
      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { rs: 109 },  // max(0, 100 + 9)
        })
      )
    })

    it('wrong BINARY — confidence 20 → p=0.6, Brier ΔRS = -11', async () => {
      // brierScore = (0.6-0)² = 0.36, rsChange = round((0.25-0.36)*100) = -11
      const { mockCommitmentUpdate, mockUserUpdate } = await setupResolveWithCommitments([{
        id: 'commit-1',
        userId: 'user1',
        cuCommitted: 20,
        binaryChoice: true,
        optionId: null,
        user: { id: 'user1', rs: 100 },
      }])

      const request = new NextRequest('http://localhost/api/forecasts/pred-1/resolve', {
        method: 'POST',
        body: JSON.stringify({ outcome: 'wrong', resolutionNote: 'Test' }),
      })

      await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

      expect(mockCommitmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rsChange: -11 }),
        })
      )
      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { rs: 89 },  // max(0, 100 - 11)
        })
      )
    })

    it('void resolution — no RS change', async () => {
      const { mockCommitmentUpdate, mockUserUpdate } = await setupResolveWithCommitments([{
        id: 'commit-1',
        userId: 'user1',
        cuCommitted: 20,
        binaryChoice: true,
        optionId: null,
        user: { id: 'user1', rs: 100 },
      }])

      const request = new NextRequest('http://localhost/api/forecasts/pred-1/resolve', {
        method: 'POST',
        body: JSON.stringify({ outcome: 'void', resolutionNote: 'Voided' }),
      })

      await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

      expect(mockCommitmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { rsChange: 0 },
        })
      )
      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { rs: 100 },  // unchanged
        })
      )
    })

    it('floors RS at 0 when loss exceeds current RS', async () => {
      // cuCommitted=100 → p=1.0, outcome=wrong → rsChange=-75, rs=2 → max(0, 2-75)=0
      const { mockUserUpdate } = await setupResolveWithCommitments([{
        id: 'commit-1',
        userId: 'user1',
        cuCommitted: 100,
        binaryChoice: true,
        optionId: null,
        user: { id: 'user1', rs: 2 },
      }])

      const request = new NextRequest('http://localhost/api/forecasts/pred-1/resolve', {
        method: 'POST',
        body: JSON.stringify({ outcome: 'wrong', resolutionNote: 'Test' }),
      })

      await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { rs: 0 },
        })
      )
    })
  })

  it('returns 400 when prediction is already resolved', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({
      user: { id: 'resolver1', email: 'resolver@example.com', role: 'RESOLVER' },
    })

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      id: 'pred-1',
      status: 'RESOLVED_CORRECT',
      outcomeType: 'BINARY',
      options: [],
      commitments: [],
    } as never)

    const request = new NextRequest('http://localhost/api/predictions/pred-1/resolve', {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'correct',
        resolutionNote: 'Test',
      }),
    })

    const response = await resolvePrediction(request, { params: Promise.resolve({ id: 'pred-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('cannot be resolved')
  })
})
