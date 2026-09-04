import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-middleware', () => ({
  withAuth:
    (handler: (req: Request, user: unknown) => unknown) =>
    (request: Request, _context: Record<string, unknown>) =>
      handler(request, { id: 'user-1', email: 'a@example.com', role: 'USER', rs: 100 }),
}))

vi.mock('@/lib/services/user', () => ({
  forgetHistory: vi.fn(),
}))

import { forgetHistory } from '@/lib/services/user'
import { POST } from '../route'

const forgetHistoryMock = vi.mocked(forgetHistory)
const CTX = { params: Promise.resolve({}) }

function req() {
  return new NextRequest('http://localhost/api/account/forget-history', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/account/forget-history', () => {
  it('returns 200 on success', async () => {
    forgetHistoryMock.mockResolvedValue({ ok: true, status: 200 })

    const res = await POST(req(), CTX)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(forgetHistoryMock).toHaveBeenCalledWith('user-1')
  })

  it('surfaces the service error and status when blocked', async () => {
    forgetHistoryMock.mockResolvedValue({
      ok: false,
      error: 'Cannot forget history while you have commitments on active or pending forecasts',
      status: 400,
    })

    const res = await POST(req(), CTX)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/active or pending/)
  })
})
