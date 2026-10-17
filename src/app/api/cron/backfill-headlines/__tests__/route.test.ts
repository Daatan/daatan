import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { findMany: vi.fn(), updateMany: vi.fn() } } }))
vi.mock('@/lib/llm/headline', () => ({ generateAndStoreHeadline: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { generateAndStoreHeadline } from '@/lib/llm/headline'
import { GET } from '../route'

const req = (secret = 'test-secret') =>
  new NextRequest('http://localhost/api/cron/backfill-headlines', { headers: { 'x-cron-secret': secret } })

describe('GET /api/cron/backfill-headlines (disabled)', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('rejects a wrong secret', async () => {
    expect((await GET(req('nope'))).status).toBe(401)
  })

  it('reports disabled and never reads or writes predictions or calls the LLM', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, disabled: true })
    expect(prisma.prediction.findMany).not.toHaveBeenCalled()
    expect(prisma.prediction.updateMany).not.toHaveBeenCalled()
    expect(generateAndStoreHeadline).not.toHaveBeenCalled()
  })
})
