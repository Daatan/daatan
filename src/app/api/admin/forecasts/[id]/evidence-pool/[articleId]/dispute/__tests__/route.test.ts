import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))
vi.mock('@/lib/services/evidence-pool', () => ({
  DISPUTE_STATUSES: ['disputed', 'upheld', 'hidden'],
  setUrlDispute: vi.fn(),
}))

import { auth } from '@/auth'
import { setUrlDispute } from '@/lib/services/evidence-pool'
import { PATCH } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const mockSet = vi.mocked(setUrlDispute)
const ctx = { params: Promise.resolve({ id: 'p1', articleId: 'a1' }) }
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/forecasts/p1/evidence-pool/a1/dispute', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
})

describe('PATCH /api/admin/forecasts/[id]/evidence-pool/[articleId]/dispute', () => {
  it('sets the dispute status for the article URL', async () => {
    mockSet.mockResolvedValue({ dispute: { urlHash: 'h-1', status: 'hidden' }, excludedRows: 2 } as never)
    const res = await PATCH(req({ status: 'hidden', note: 'counsel' }), ctx)
    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith('p1', 'a1', 'hidden', 'counsel')
    expect((await res.json()).excludedRows).toBe(2)
  })

  it('404s when the article is not in this forecast pool', async () => {
    mockSet.mockResolvedValue(null)
    const res = await PATCH(req({ status: 'disputed' }), ctx)
    expect(res.status).toBe(404)
  })

  it('rejects an unknown status', async () => {
    const res = await PATCH(req({ status: 'deleted' }), ctx)
    expect(res.status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('is admin-only', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
    const res = await PATCH(req({ status: 'disputed' }), ctx)
    expect(res.status).toBe(403)
    expect(mockSet).not.toHaveBeenCalled()
  })
})
