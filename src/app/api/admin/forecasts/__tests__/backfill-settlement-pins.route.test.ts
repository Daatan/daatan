import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/evidence-pool', () => ({ pushCredibilityFeedback: vi.fn() }))
vi.mock('@/lib/services/oracleClient', () => ({
  getOracleConfig: vi.fn(() => ({ baseUrl: 'http://oracle', key: 'k' })),
  oracleFetch: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { pushCredibilityFeedback } from '@/lib/services/evidence-pool'
import { oracleFetch } from '@/lib/services/oracleClient'
import { POST } from '../backfill-settlement-pins/route'

const findMany = vi.mocked(prisma.prediction.findMany)
const push = vi.mocked(pushCredibilityFeedback)
const fetchOracle = vi.mocked(oracleFetch)

const CRON_HEADERS = { 'x-cron-secret': 'test-secret' }

function req(url = 'http://localhost/api/admin/forecasts/backfill-settlement-pins') {
  return new NextRequest(url, { method: 'POST', headers: CRON_HEADERS })
}

/** Ledger report bodies, in call order. */
function ledgerReturns(...reports: Array<{ total_settled_pins: number; contradicted_count: number }>) {
  for (const r of reports) {
    fetchOracle.mockResolvedValueOnce({ ok: true, json: async () => r } as never)
  }
}

describe('POST /api/admin/forecasts/backfill-settlement-pins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    push.mockResolvedValue(undefined)
  })

  it('re-pushes every resolved binary carrying a pin, with the outcome its status implies', async () => {
    findMany.mockResolvedValue([
      { id: 'pred-1', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-07-07') },
      { id: 'pred-2', status: 'RESOLVED_WRONG', resolvedAt: new Date('2026-07-15') },
    ] as never)
    ledgerReturns({ total_settled_pins: 0, contradicted_count: 0 }, { total_settled_pins: 2, contradicted_count: 1 })

    const body = await (await POST(req())).json()

    expect(push).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenNthCalledWith(1, 'pred-1', true, new Date('2026-07-07'))
    expect(push).toHaveBeenNthCalledWith(2, 'pred-2', false, new Date('2026-07-15'))
    expect(body.processed).toBe(2)
    expect(body.predictionIds).toEqual(['pred-1', 'pred-2'])
  })

  // The push is fire-and-forget and swallows its own failures, so a local tally
  // would report success for a run that wrote nothing — the exact fail-open that
  // hid this bug for a week (daatan#1451).
  it('reports the ledger delta rather than its own attempt count', async () => {
    findMany.mockResolvedValue([
      { id: 'pred-1', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-07-07') },
    ] as never)
    ledgerReturns({ total_settled_pins: 4, contradicted_count: 3 }, { total_settled_pins: 5, contradicted_count: 3 })

    const body = await (await POST(req())).json()

    expect(body.recorded).toBe(1)
    expect(body.ledgerBefore.total_settled_pins).toBe(4)
    expect(body.ledgerAfter.total_settled_pins).toBe(5)
  })

  it('reports recorded=null when the ledger cannot be read, instead of a zero that reads as clean', async () => {
    findMany.mockResolvedValue([
      { id: 'pred-1', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-07-07') },
    ] as never)
    fetchOracle.mockResolvedValue({ ok: false, status: 500 } as never)

    const body = await (await POST(req())).json()

    expect(body.recorded).toBeNull()
    expect(body.processed).toBe(1)
  })

  it('selects only resolved binaries whose snapshot roster carries a settled pin', async () => {
    findMany.mockResolvedValue([] as never)
    ledgerReturns({ total_settled_pins: 0, contradicted_count: 0 }, { total_settled_pins: 0, contradicted_count: 0 })

    await POST(req())

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcomeType: 'BINARY',
          status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
          contextSnapshots: {
            some: {
              kind: { not: 'clock' },
              insufficientData: false,
              oracleSnapshot: { path: ['settled'], equals: true },
            },
          },
        }),
      }),
    )
  })

  it('rejects a request with no admin session and no cron secret', async () => {
    findMany.mockResolvedValue([] as never)
    const res = await POST(
      new NextRequest('http://localhost/api/admin/forecasts/backfill-settlement-pins', { method: 'POST' }),
    )
    expect(res.status).toBe(401)
    expect(push).not.toHaveBeenCalled()
  })
})
