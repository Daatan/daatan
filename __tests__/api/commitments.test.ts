import { vi } from 'vitest'

const { mockAuth, mockFindMany, mockCount } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    commitment: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}))

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/commitments/route'

const mockUser = {
  id: 'user-1',
  email: 'user@test.com',
  role: 'USER' as const,
  rs: 0,
}

const mockCommitment = {
  id: 'commitment-1',
  cuCommitted: 50,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
  prediction: {
    id: 'pred-1',
    claimText: 'Test prediction',
    status: 'OPEN',
    resolveByDatetime: new Date('2026-12-31'),
    outcomeType: 'BINARY',
  },
  option: {
    id: 'opt-1',
    text: 'Yes',
  },
}

describe('GET /api/commitments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([mockCommitment])
    mockCount.mockResolvedValue(1)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/commitments')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })

  it('returns paginated commitments for authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: mockUser })
    const req = new NextRequest('http://localhost/api/commitments')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('commitments')
    expect(body).toHaveProperty('pagination')
    expect(body.commitments).toHaveLength(1)
    expect(body.commitments[0].id).toBe('commitment-1')
  })

  it('only returns commitments for the authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: mockUser })
    const req = new NextRequest('http://localhost/api/commitments')
    await GET(req, { params: Promise.resolve({}) })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      })
    )
  })

  it('returns correct pagination metadata', async () => {
    mockAuth.mockResolvedValue({ user: mockUser })
    mockCount.mockResolvedValue(25)
    const req = new NextRequest('http://localhost/api/commitments?page=2&limit=10')
    const res = await GET(req, { params: Promise.resolve({}) })

    const body = await res.json()
    expect(body.pagination.page).toBe(2)
    expect(body.pagination.limit).toBe(10)
    expect(body.pagination.total).toBe(25)
    expect(body.pagination.totalPages).toBe(3)
  })

  it('filters by predictionId when provided', async () => {
    mockAuth.mockResolvedValue({ user: mockUser })
    mockFindMany.mockResolvedValue([mockCommitment])
    mockCount.mockResolvedValue(1)
    // predictionId must be a valid CUID
    const validCuid = 'clh3bcde50000qzrmgfw4n1g0'
    const req = new NextRequest(`http://localhost/api/commitments?predictionId=${validCuid}`)
    await GET(req, { params: Promise.resolve({}) })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ predictionId: validCuid }),
      })
    )
  })

  it('returns empty list when user has no commitments', async () => {
    mockAuth.mockResolvedValue({ user: mockUser })
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    const req = new NextRequest('http://localhost/api/commitments')
    const res = await GET(req, { params: Promise.resolve({}) })

    const body = await res.json()
    expect(body.commitments).toHaveLength(0)
    expect(body.pagination.total).toBe(0)
    expect(body.pagination.totalPages).toBe(0)
  })
})
