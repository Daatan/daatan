import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/signup/route'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 3600000 }),
  rateLimitResponse: vi.fn().mockReturnValue(new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), { status: 429 })),
  clientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password'),
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('POST /api/auth/signup', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { checkRateLimit } = await import('@/lib/rate-limit')
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 3600000 })
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 })

    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'password123' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(429)
  })

  it('successfully creates a new user', async () => {
    const { prisma } = await import('@/lib/prisma')
    
    // 1. No existing user
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    // 2. No collisions
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
    // 3. User creation result
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      name: 'Test User',
      email: 'test@example.com',
      username: 'test_user',
    } as never)

    const body = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    }

    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.email).toBe('test@example.com')
    expect(data.username).toBe('test_user')
    
    expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12)
    expect(prisma.user.create).toHaveBeenCalled()
  })

  it('returns 400 if user email already exists', async () => {
    const { prisma } = await import('@/lib/prisma')
    
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing-id' } as any)

    const body = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    }

    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('already exists')
  })

  it('validates input data', async () => {
    const body = {
      name: '', // Invalid
      email: 'invalid-email', // Invalid
      password: 'short', // Invalid
    }

    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
