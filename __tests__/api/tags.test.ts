import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock prisma BEFORE any imports
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

// Mock session/auth
const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: mockAuth }))

// Mock authOptions for backward compatibility if any middleware/helper needs it
vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// Import after mocks
import { GET, POST } from '@/app/api/tags/route'

describe('GET /api/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all tags with usage counts', async () => {
    const { prisma } = await import('@/lib/prisma')

    const mockTags = [
      {
        id: 'tag1',
        name: 'Politics',
        slug: 'politics',
        createdAt: new Date(),
        _count: { predictions: 5 },
      },
      {
        id: 'tag2',
        name: 'AI',
        slug: 'ai',
        createdAt: new Date(),
        _count: { predictions: 10 },
      },
    ]

    vi.mocked(prisma.tag.findMany).mockResolvedValue(mockTags as any)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tags).toHaveLength(2)
    expect(data.tags[0]).toEqual({
      id: 'tag1',
      name: 'Politics',
      slug: 'politics',
      count: 5,
    })
    expect(data.tags[1]).toEqual({
      id: 'tag2',
      name: 'AI',
      slug: 'ai',
      count: 10,
    })
  })

  it('returns empty array when no tags exist', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.tag.findMany).mockResolvedValue([])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tags).toHaveLength(0)
  })

  it('orders tags by usage count descending, then by name', async () => {
    const { prisma } = await import('@/lib/prisma')

    const mockTags = [
      { id: 'tag1', name: 'AI', slug: 'ai', createdAt: new Date(), _count: { predictions: 5 } },
      { id: 'tag2', name: 'Politics', slug: 'politics', createdAt: new Date(), _count: { predictions: 10 } },
      { id: 'tag3', name: 'Crypto', slug: 'crypto', createdAt: new Date(), _count: { predictions: 10 } },
    ]

    vi.mocked(prisma.tag.findMany).mockResolvedValue(mockTags as any)

    await GET()

    expect(prisma.tag.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { predictions: true } },
      },
      orderBy: [
        { predictions: { _count: 'desc' } },
        { name: 'asc' },
      ],
    })
  })

  it('handles database errors gracefully', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.tag.findMany).mockRejectedValue(new Error('DB error'))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch tags')
  })
})

describe('POST /api/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createMockUser = (overrides = {}) => ({
    id: 'user1',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'ADMIN',
    rs: 100,
    ...overrides,
  })

  const createRequest = (body: unknown) => {
    return new NextRequest('http://localhost/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('creates a new tag for admin user', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.tag.create).mockResolvedValue({
      id: 'new-tag',
      name: 'Technology',
      slug: 'technology',
      createdAt: new Date(),
    })

    const request = createRequest({ name: 'Technology' })
    const response = await POST(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data).toEqual({
      id: 'new-tag',
      name: 'Technology',
      slug: 'technology',
    })
  })

  it('rejects non-admin users', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser({ role: 'USER' }) } as any)

    const request = createRequest({ name: 'Technology' })
    const response = await POST(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden: Only admins can create tags')
  })

  it('rejects tag with empty name', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)

    const request = createRequest({ name: '' })
    const response = await POST(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Tag name is required')
  })

  it('rejects tag with name exceeding 50 characters', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)

    const longName = 'a'.repeat(51)
    const request = createRequest({ name: longName })
    const response = await POST(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Tag name must be 50 characters or less')
  })

  it('rejects duplicate tag names', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({
      id: 'existing', createdAt: new Date(),
      name: 'Politics',
      slug: 'politics',
    })

    const request = createRequest({ name: 'Politics' })
    const response = await POST(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Tag with this name already exists')
  })

  it('trims whitespace from tag name', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.tag.create).mockResolvedValue({
      id: 'new-tag',
      name: 'Technology',
      slug: 'technology',
      createdAt: new Date(),
    })

    const request = createRequest({ name: '  Technology  ' })
    await POST(request, { params: Promise.resolve({}) } as any)

    expect(prisma.tag.create).toHaveBeenCalledWith({
      data: {
        name: 'Technology',
        slug: 'technology',
      },
    })
  })

  it('generates URL-friendly slug', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.tag.create).mockResolvedValue({
      id: 'new-tag',
      name: 'US Politics',
      slug: 'us-politics',
      createdAt: new Date(),
    })

    const request = createRequest({ name: 'US Politics' })
    await POST(request, { params: Promise.resolve({}) } as any)

    expect(prisma.tag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'us-politics',
        }),
      })
    )
  })

  it('handles database errors gracefully', async () => {
    const { prisma } = await import('@/lib/prisma')

    mockAuth.mockResolvedValue({ user: createMockUser() } as any)
    vi.mocked(prisma.tag.findUnique).mockRejectedValue(new Error('DB error'))

    const request = createRequest({ name: 'Technology' })
    const response = await POST(request, { params: Promise.resolve({}) } as any)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create tag')
  })
})
