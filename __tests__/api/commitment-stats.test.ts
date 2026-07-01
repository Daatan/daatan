import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/commitments/stats/route'

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commitment: {
      findMany: vi.fn(),
    },
  },
}))

describe('GET /api/commitments/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/commitments/stats')
    const response = await GET(request, { params: Promise.resolve({}) } as any)

    expect(response.status).toBe(401)
  })

  it('returns correct stats for a user with mixed commitments', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user1', email: 'test@example.com', role: 'USER' },
    })

    const { prisma } = await import('@/lib/prisma')

    const mockCommitments = [
      // Correct: brierScore < 0.25
      { brierScore: 0.05, rsChange: 1.0, prediction: { status: 'RESOLVED_CORRECT' } },
      // Wrong: brierScore >= 0.25
      { brierScore: 0.6, rsChange: -1.0, prediction: { status: 'RESOLVED_WRONG' } },
      // Pending (no brierScore yet)
      { brierScore: null, rsChange: null, prediction: { status: 'ACTIVE' } },
      // Another correct
      { brierScore: 0.1, rsChange: 1.5, prediction: { status: 'RESOLVED_CORRECT' } },
    ]

    vi.mocked(prisma.commitment.findMany).mockResolvedValue(mockCommitments as any)

    const request = new NextRequest('http://localhost/api/commitments/stats')
    const response = await GET(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.total).toBe(4)
    expect(data.resolved).toBe(3)
    expect(data.correct).toBe(2)
    expect(data.wrong).toBe(1)
    expect(data.pending).toBe(1)
    expect(data.accuracy).toBe(67) // 2/3 = 66.7 -> Math.round = 67
    expect(data.totalRsChange).toBe(1.5) // 1.0 + (-1.0) + 0 + 1.5
  })

  it('returns null accuracy when no commitments are resolved', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user1', email: 'test@example.com', role: 'USER' },
    })

    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.commitment.findMany).mockResolvedValue([
      { rsChange: null, prediction: { status: 'ACTIVE' } },
    ] as any)

    const request = new NextRequest('http://localhost/api/commitments/stats')
    const response = await GET(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(data.accuracy).toBeNull()
    expect(data.total).toBe(1)
    expect(data.pending).toBe(1)
  })

  it('returns zeros when user has no commitments', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user1', email: 'test@example.com', role: 'USER' },
    })

    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.commitment.findMany).mockResolvedValue([])

    const request = new NextRequest('http://localhost/api/commitments/stats')
    const response = await GET(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(data.total).toBe(0)
    expect(data.accuracy).toBeNull()
  })
})
