/**
 * @jest-environment node
 * Coverage for withAuth: the shared session/role guard wrapping API routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const mockNotifySecurityError = vi.fn()
const mockNotifyServerError = vi.fn()
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: (...args: unknown[]) => mockNotifyServerError(...args),
  notifySecurityError: (...args: unknown[]) => mockNotifySecurityError(...args),
}))

import { withAuth } from '@/lib/api-middleware'

function makeRequest(pathname = '/api/test') {
  return new NextRequest(new URL(`https://daatan.com${pathname}`))
}

describe('withAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects with 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const handler = vi.fn()
    const wrapped = withAuth(handler)

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
    expect(handler).not.toHaveBeenCalled()
    expect(mockNotifySecurityError).toHaveBeenCalledWith('/api/test', 401, 'Unauthorized access attempt')
  })

  it('rejects with 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: { id: undefined, role: 'USER' } })
    const handler = vi.fn()
    const wrapped = withAuth(handler)

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects with 403 when role is not in the allowed list', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', email: 'u1@daatan.test', role: 'USER' } })
    const handler = vi.fn()
    const wrapped = withAuth(handler, { roles: ['ADMIN'] })

    const res = await wrapped(makeRequest('/api/admin'), { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Forbidden')
    expect(handler).not.toHaveBeenCalled()
    expect(mockNotifySecurityError).toHaveBeenCalledWith(
      '/api/admin',
      403,
      expect.stringContaining('ADMIN'),
      { id: 'u1', email: 'u1@daatan.test' },
    )
  })

  it('calls the handler when authenticated with no role restriction', async () => {
    const user = { id: 'u1', email: 'u1@daatan.test', role: 'USER', rs: 10 }
    mockAuth.mockResolvedValue({ user })
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const wrapped = withAuth(handler)

    const res = await wrapped(makeRequest(), { params: Promise.resolve({ id: '42' }) })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    const [, passedUser, context] = handler.mock.calls[0]
    expect(passedUser).toEqual(user)
    expect(context).toEqual({ params: { id: '42' } })
  })

  it('calls the handler when the user role is in the allowed list', async () => {
    const user = { id: 'admin-1', email: 'admin@daatan.test', role: 'ADMIN', rs: 10 }
    mockAuth.mockResolvedValue({ user })
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const wrapped = withAuth(handler, { roles: ['ADMIN', 'APPROVER'] })

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('treats an empty roles array as "any authenticated user"', async () => {
    const user = { id: 'u1', email: 'u1@daatan.test', role: 'USER', rs: 10 }
    mockAuth.mockResolvedValue({ user })
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const wrapped = withAuth(handler, { roles: [] })

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('catches handler errors and returns a 500 via handleRouteError', async () => {
    const user = { id: 'u1', email: 'u1@daatan.test', role: 'USER', rs: 10 }
    mockAuth.mockResolvedValue({ user })
    const handler = vi.fn().mockRejectedValue(new Error('boom'))
    const wrapped = withAuth(handler)

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(500)
    expect(mockNotifyServerError).toHaveBeenCalled()
  })

  it('does not notify Telegram for ZodError-style handler failures', async () => {
    const user = { id: 'u1', email: 'u1@daatan.test', role: 'USER', rs: 10 }
    mockAuth.mockResolvedValue({ user })
    const { z } = await import('zod')
    const zodError = new z.ZodError([{ code: 'custom', message: 'bad input', path: ['field'] }])
    const handler = vi.fn().mockRejectedValue(zodError)
    const wrapped = withAuth(handler)

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
    expect(mockNotifyServerError).not.toHaveBeenCalled()
  })

  it('propagates auth() throwing as a caught error (500)', async () => {
    mockAuth.mockRejectedValue(new Error('session store unavailable'))
    const handler = vi.fn()
    const wrapped = withAuth(handler)

    const res = await wrapped(makeRequest(), { params: Promise.resolve({}) })

    expect(res.status).toBe(500)
    expect(handler).not.toHaveBeenCalled()
  })
})
