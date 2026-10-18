import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { findMany: vi.fn() } } }))
vi.mock('@/lib/services/evidence-pool', () => ({ pushCredibilityFeedback: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { pushCredibilityFeedback } from '@/lib/services/evidence-pool'
import { POST } from '../backfill-tags/route'

const findMany = vi.mocked(prisma.prediction.findMany)
const push = vi.mocked(pushCredibilityFeedback)

function req(query = '', headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest(`http://localhost/api/admin/forecasts/backfill-tags${query}`, { method: 'POST', headers })
}

describe('POST /api/admin/forecasts/backfill-tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    push.mockResolvedValue(undefined)
  })

  it('re-pushes tagged resolved binaries with the outcome their status implies', async () => {
    findMany.mockResolvedValue([
      { id: 'a', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-07-07') },
      { id: 'b', status: 'RESOLVED_WRONG', resolvedAt: new Date('2026-07-15') },
    ] as never)

    const body = await (await POST(req())).json()

    expect(push).toHaveBeenNthCalledWith(1, 'a', true, new Date('2026-07-07'))
    expect(push).toHaveBeenNthCalledWith(2, 'b', false, new Date('2026-07-15'))
    expect(body).toEqual({ processed: 2, nextCursor: null })
  })

  it('pages: a full page returns the cursor, and ?after resumes from it', async () => {
    findMany.mockResolvedValue([
      { id: 'a', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-07-07') },
      { id: 'b', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-07-08') },
    ] as never)

    const body = await (await POST(req('?limit=2&after=z'))).json()

    expect(body.nextCursor).toBe('b')
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: 'z' }, skip: 1, take: 2 }))
  })

  it('rejects an unauthenticated caller', async () => {
    const res = await POST(req('', {}))
    expect(res.status).toBe(401)
    expect(push).not.toHaveBeenCalled()
  })
})
