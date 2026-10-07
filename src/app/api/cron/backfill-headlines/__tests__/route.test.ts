import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { findMany: vi.fn(), count: vi.fn() } } }))
vi.mock('@/lib/llm/headline', () => ({ generateAndStoreHeadline: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { generateAndStoreHeadline } from '@/lib/llm/headline'
import { GET } from '../route'

const findMany = vi.mocked(prisma.prediction.findMany)
const count = vi.mocked(prisma.prediction.count)
const store = vi.mocked(generateAndStoreHeadline)

const req = (secret = 'test-secret', qs = '') =>
  new NextRequest(`http://localhost/api/cron/backfill-headlines${qs}`, { headers: { 'x-cron-secret': secret } })

describe('GET /api/cron/backfill-headlines', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('rejects a wrong secret', async () => {
    expect((await GET(req('nope'))).status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('selects NULL headlines newest first and counts each outcome', async () => {
    findMany.mockResolvedValue([
      { id: 'a', claimText: 'A' }, { id: 'b', claimText: 'B' }, { id: 'c', claimText: 'C' },
    ] as never)
    store.mockResolvedValueOnce('stored').mockResolvedValueOnce('rejected').mockRejectedValueOnce(new Error('db'))
    count.mockResolvedValue(7)

    const body = await (await GET(req())).json()

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { headline: null }, orderBy: { createdAt: 'desc' }, take: 25,
    }))
    expect(body).toEqual({ ok: true, stored: 1, rejected: 1, failed: 1, remaining: 7 })
  })

  it('caps ?limit at 40', async () => {
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)
    await GET(req('test-secret', '?limit=500'))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 40 }))
  })
})
