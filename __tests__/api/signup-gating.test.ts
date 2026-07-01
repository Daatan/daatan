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
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed_password') } }))

vi.mock('@/lib/services/telegram', () => ({ notifyNewUserRegistered: vi.fn() }))

vi.mock('@/lib/services/invite', () => ({ consumeInvite: vi.fn() }))

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
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'id', name: 'Jane Doe', email: 'jane@acme.com', username: 'jane_doe',
    } as never)
  })

  it('blocks closed signup with 403 (invite-only) when self_hosted and no invite is given', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req(validBody))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('invite-only')
  })

  it('admits closed signup when a valid invite is supplied and consumed', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const { consumeInvite } = await import('@/lib/services/invite')
    vi.mocked(consumeInvite).mockResolvedValue(true)
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req({ ...validBody, invite: 'good-token' }))
    expect(res.status).toBe(201)
    expect(consumeInvite).toHaveBeenCalledWith('good-token')
  })

  it('rejects closed signup with 403 when the invite is invalid/used', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const { consumeInvite } = await import('@/lib/services/invite')
    vi.mocked(consumeInvite).mockResolvedValue(false)
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req({ ...validBody, invite: 'bad-token' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('invite-only')
  })

  it('allows signup when self_hosted explicitly re-opens it (no invite needed)', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.SELF_HOST_OPEN_SIGNUP = 'true'
    const { consumeInvite } = await import('@/lib/services/invite')
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(req(validBody))
    expect(res.status).toBe(201)
    expect(consumeInvite).not.toHaveBeenCalled()
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
