import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Verifies the self-host access gates on the credentials signup route:
 * closed-signup (edition-driven) and the email-domain allow-list. Both must be
 * inert for the SaaS deploy (edition unset/saas, vars unset).
 */

const mockEnv: Record<string, unknown> = {}

vi.mock('@/env', () => ({ env: mockEnv }))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 4, resetAt: 0 }),
  rateLimitResponse: vi.fn(),
  clientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((cb) => cb(mockTx)),
  },
}))

const mockTx = {
  user: { create: vi.fn() },
  cuTransaction: { create: vi.fn() },
}

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed_password') } }))

vi.mock('@/lib/services/telegram', () => ({ notifyNewUserRegistered: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

function req(body: unknown) {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const validBody = { name: 'Jane Doe', email: 'jane@acme.com', password: 'password123' }

describe('POST /api/auth/signup — self-host access gates', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
    mockTx.user.create.mockResolvedValue({
      id: 'id', name: 'Jane Doe', email: 'jane@acme.com', username: 'jane_doe',
    })
  })

  it('blocks public signup with 403 when edition is self_hosted and open-signup is off', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req(validBody))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('disabled')
  })

  it('allows signup when self_hosted explicitly re-opens it', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.SELF_HOST_OPEN_SIGNUP = 'true'
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req(validBody))
    expect(res.status).toBe(201)
  })

  it('rejects an out-of-domain email with 403 when ALLOWED_EMAIL_DOMAINS is set', async () => {
    mockEnv.ALLOWED_EMAIL_DOMAINS = 'acme.com'
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req({ ...validBody, email: 'jane@evil.com' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('domain')
  })

  it('admits an in-domain email when ALLOWED_EMAIL_DOMAINS is set', async () => {
    mockEnv.ALLOWED_EMAIL_DOMAINS = 'acme.com'
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req(validBody))
    expect(res.status).toBe(201)
  })

  it('is inert for the SaaS deploy (no env set): signup succeeds', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req({ ...validBody, email: 'jane@anywhere.io' }))
    expect(res.status).toBe(201)
  })
})
