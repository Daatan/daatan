import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { panelPaymentFailure: { upsert: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { recordPanelPaymentFailure } from '@/lib/services/panel-failures'

const upsert = vi.mocked(prisma.panelPaymentFailure.upsert)

/** The recorder is fire-and-forget; let its floating promise settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('recordPanelPaymentFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({} as never)
  })

  it('upserts the UTC-day counter: first 402 creates, later ones increment', async () => {
    const now = new Date('2026-08-19T05:06:12Z')
    recordPanelPaymentFailure('qwen/qwen3-235b-a22b-2507', now)
    await flush()

    expect(upsert).toHaveBeenCalledWith({
      where: { day: '2026-08-19' },
      create: { day: '2026-08-19', count: 1, lastSeenAt: now, lastModel: 'qwen/qwen3-235b-a22b-2507' },
      update: {
        count: { increment: 1 },
        lastSeenAt: now,
        lastModel: 'qwen/qwen3-235b-a22b-2507',
      },
    })
  })

  it('keys by the UTC day, not local time', async () => {
    recordPanelPaymentFailure('m', new Date('2026-08-19T23:59:59Z'))
    await flush()
    expect(upsert.mock.calls[0][0].where).toEqual({ day: '2026-08-19' })
  })

  it('swallows a recording failure — the sweep must never pay for its own telemetry', async () => {
    upsert.mockRejectedValue(new Error('connection terminated') as never)
    // Must neither throw synchronously nor leave an unhandled rejection behind.
    expect(() => recordPanelPaymentFailure('m')).not.toThrow()
    await flush()
  })
})
