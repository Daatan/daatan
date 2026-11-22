import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'cron-secret-value' } }))
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { findUnique: vi.fn() } } }))
vi.mock('@/lib/services/evidence-pool', () => ({ retractCredibilityFeedback: vi.fn() }))

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { retractCredibilityFeedback } from '@/lib/services/evidence-pool'
import { POST } from '../[id]/retract-credibility/route'

const retract = vi.mocked(retractCredibilityFeedback)
const findPrediction = vi.mocked(prisma.prediction.findUnique)

const call = (headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('http://localhost/api/admin/forecasts/p1/retract-credibility', { method: 'POST', headers }),
    { params: Promise.resolve({ id: 'p1' }) },
  )

const signedInAs = (role: string) =>
  vi.mocked(auth).mockResolvedValue({ user: { id: 'admin-1', role } } as never)

describe('POST /api/admin/forecasts/[id]/retract-credibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signedInAs('ADMIN')
    findPrediction.mockResolvedValue({ id: 'p1' } as never)
    retract.mockResolvedValue({ status: 'ok', retro: { feedback_removed: 11 } })
  })

  it('retracts for an admin and returns what retro removed', async () => {
    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ predictionId: 'p1', retro: { feedback_removed: 11 } })
    expect(retract).toHaveBeenCalledWith('p1')
  })

  it('accepts the cron secret without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)

    const res = await call({ 'x-cron-secret': 'cron-secret-value' })

    expect(res.status).toBe(200)
    expect(retract).toHaveBeenCalledWith('p1')
  })

  it('falls back to the session check on a wrong secret', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)

    expect((await call({ 'x-cron-secret': 'wrong' })).status).toBe(401)
    expect(retract).not.toHaveBeenCalled()
  })

  it.each(['RESOLVER', 'APPROVER', 'USER'])('refuses %s', async (role) => {
    signedInAs(role)

    expect((await call()).status).toBe(403)
    expect(retract).not.toHaveBeenCalled()
  })

  it('404s an unknown forecast without calling retro', async () => {
    findPrediction.mockResolvedValue(null)

    expect((await call()).status).toBe(404)
    expect(retract).not.toHaveBeenCalled()
  })

  it.each([
    ['skipped', 409],
    ['failed', 502],
  ] as const)('reports a %s retract as %i', async (status, code) => {
    retract.mockResolvedValue({ status })

    expect((await call()).status).toBe(code)
  })
})
