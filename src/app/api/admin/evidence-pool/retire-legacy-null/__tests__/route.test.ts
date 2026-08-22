import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
})) // withAuth's error path notifies on 5xx — keep it a no-op in tests

vi.mock('@/lib/services/evidence-pool', () => ({ retireLegacyNullRows: vi.fn() }))

import { auth } from '@/auth'
import { retireLegacyNullRows } from '@/lib/services/evidence-pool'
import { POST } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const retire = vi.mocked(retireLegacyNullRows)

function req(body: unknown) {
  return new NextRequest('http://localhost/api/admin/evidence-pool/retire-legacy-null', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
  retire.mockResolvedValue({ matched: 124 })
})

describe('POST /api/admin/evidence-pool/retire-legacy-null', () => {
  it('defaults to dry-run when mode is omitted', async () => {
    const res = await POST(req({}), ctx)

    expect(res.status).toBe(200)
    expect(retire).toHaveBeenCalledWith(false)
  })

  it('applies only on an explicit mode=apply', async () => {
    await POST(req({ mode: 'apply' }), ctx)

    expect(retire).toHaveBeenCalledWith(true)
  })

  it('rejects an unrecognised mode rather than silently defaulting to dry-run', async () => {
    const res = await POST(req({ mode: 'aply' }), ctx)

    expect(res.status).toBe(400)
    expect(retire).not.toHaveBeenCalled()
  })

  it('rejects a non-admin session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
    const res = await POST(req({}), ctx)

    expect(res.status).toBe(403)
    expect(retire).not.toHaveBeenCalled()
  })
})
