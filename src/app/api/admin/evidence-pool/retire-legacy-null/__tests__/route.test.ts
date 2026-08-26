import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
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

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/admin/evidence-pool/retire-legacy-null', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
  retire.mockResolvedValue({ matched: 124 })
})

describe('POST /api/admin/evidence-pool/retire-legacy-null', () => {
  it('defaults to dry-run when mode is omitted', async () => {
    const res = await POST(req({}))

    expect(res.status).toBe(200)
    expect(retire).toHaveBeenCalledWith(false)
  })

  it('applies only on an explicit mode=apply', async () => {
    await POST(req({ mode: 'apply' }))

    expect(retire).toHaveBeenCalledWith(true)
  })

  it('rejects an unrecognised mode rather than silently defaulting to dry-run', async () => {
    const res = await POST(req({ mode: 'aply' }))

    expect(res.status).toBe(400)
    expect(retire).not.toHaveBeenCalled()
  })

  it('rejects a non-admin session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
    const res = await POST(req({}))

    expect(res.status).toBe(403)
    expect(retire).not.toHaveBeenCalled()
  })

  it('authenticates via the x-cron-secret header without a session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req({}, { 'x-cron-secret': 'test-secret' }))

    expect(res.status).toBe(200)
    expect(retire).toHaveBeenCalledWith(false)
  })

  it('rejects a wrong cron secret and falls through to (missing) session auth', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req({}, { 'x-cron-secret': 'wrong-secret' }))

    expect(res.status).toBe(401)
    expect(retire).not.toHaveBeenCalled()
  })
})
