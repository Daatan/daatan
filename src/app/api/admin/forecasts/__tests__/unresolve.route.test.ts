import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/prediction-unresolve', () => ({ unresolvePrediction: vi.fn() }))
vi.mock('@/lib/services/evidence-pool', () => ({ retractCredibilityFeedback: vi.fn() }))
vi.mock('@/lib/services/news-indexer', () => ({ notifyNewsIndexerUnresolve: vi.fn() }))

import { auth } from '@/auth'
import { unresolvePrediction } from '@/lib/services/prediction-unresolve'
import { retractCredibilityFeedback } from '@/lib/services/evidence-pool'
import { notifyNewsIndexerUnresolve } from '@/lib/services/news-indexer'
import { POST } from '../[id]/unresolve/route'

const unresolve = vi.mocked(unresolvePrediction)
const retract = vi.mocked(retractCredibilityFeedback)
const notifyNi = vi.mocked(notifyNewsIndexerUnresolve)

const call = (body: unknown = { reason: 'resolved too early' }) =>
  POST(
    new NextRequest('http://localhost/api/admin/forecasts/p1/unresolve', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'p1' }) } as never,
  )

const signedInAs = (role: string) =>
  vi.mocked(auth).mockResolvedValue({ user: { id: 'admin-1', role } } as never)

const reverted = (revertedOutcome: string, outcomeType = 'BINARY') =>
  ({ prediction: { status: 'ACTIVE' }, revertedOutcome, outcomeType }) as never

describe('POST /api/admin/forecasts/[id]/unresolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signedInAs('ADMIN')
    retract.mockResolvedValue(undefined)
    unresolve.mockResolvedValue(reverted('wrong'))
  })

  it('reverts, then undoes both external pushes', async () => {
    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ACTIVE' })
    expect(unresolve).toHaveBeenCalledWith('p1', 'admin-1', 'resolved too early')
    expect(notifyNi).toHaveBeenCalledWith('p1')
    expect(retract).toHaveBeenCalledWith('p1')
  })

  it.each(['RESOLVER', 'APPROVER', 'USER'])('refuses %s', async (role) => {
    signedInAs(role)

    expect((await call()).status).toBe(403)
    expect(unresolve).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ reason: '' }], [{ reason: '   ' }]])('requires a reason: %j', async (body) => {
    expect((await call(body)).status).toBe(400)
    expect(unresolve).not.toHaveBeenCalled()
  })

  it('passes a refusal through and touches nothing external', async () => {
    unresolve.mockRejectedValue(Object.assign(new Error('A later resolution touched the same users'), { statusCode: 409 }))

    const res = await call()

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('later resolution')
    expect(notifyNi).not.toHaveBeenCalled()
    expect(retract).not.toHaveBeenCalled()
  })

  it.each([
    ['void', 'BINARY'],
    ['unresolvable', 'BINARY'],
    ['correct', 'MULTIPLE_CHOICE'],
  ])('%s on %s was never pushed to retro, but did reach news-indexer', async (outcome, type) => {
    unresolve.mockResolvedValue(reverted(outcome, type))

    await call()

    expect(retract).not.toHaveBeenCalled()
    expect(notifyNi).toHaveBeenCalledWith('p1')
  })

  it('a failed retract does not fail the revert', async () => {
    retract.mockRejectedValue(new Error('down'))

    expect((await call()).status).toBe(200)
  })
})
