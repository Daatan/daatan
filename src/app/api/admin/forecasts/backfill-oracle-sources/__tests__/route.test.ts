import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findMany: vi.fn(), count: vi.fn() } },
}))
vi.mock('@/lib/services/oracle-backfill', () => ({ refreshOracleSnapshot: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { refreshOracleSnapshot } from '@/lib/services/oracle-backfill'
import { POST } from '../route'

function req(headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/admin/forecasts/backfill-oracle-sources', {
    method: 'POST',
    headers,
  })
}

describe('POST /api/admin/forecasts/backfill-oracle-sources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
    vi.mocked(prisma.prediction.count).mockResolvedValue(0)
  })

  it('queries only ACTIVE, public predictions — daatan#1603', async () => {
    await POST(req())

    expect(prisma.prediction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', isPublic: true }),
      }),
    )
    expect(prisma.prediction.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', isPublic: true }),
      }),
    )
    expect(refreshOracleSnapshot).not.toHaveBeenCalled()
  })
})
