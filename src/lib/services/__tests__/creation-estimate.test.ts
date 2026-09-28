/**
 * daatan#1777: a new forecast gets a first real Oracul estimate right after
 * creation instead of keeping the express generator's ungrounded guess (which
 * hedged to 50 whenever it had nothing) until a news-indexer push happened to match.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const errorLog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: errorLog, debug: vi.fn() }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
  },
}))

const getOracleConfigMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/oracleClient', () => ({
  getOracleConfig: () => getOracleConfigMock(),
}))

const refreshOracleSnapshotMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/oracle-backfill', () => ({
  refreshOracleSnapshot: (...args: unknown[]) => refreshOracleSnapshotMock(...args),
}))

import { prisma } from '@/lib/prisma'
import { runCreationEstimate, scheduleCreationEstimate } from '@/lib/services/creation-estimate'

const baseRow = {
  id: 'pred-1',
  status: 'ACTIVE',
  isPublic: true,
  outcomeType: 'BINARY',
  claimText: 'The voter turnout in the upcoming Knesset elections will reach at least 73%.',
  claimDirection: 'UP',
  claimDeadline: new Date('2026-10-27'),
  createdAt: new Date('2026-09-27'),
  claimArchetype: 'SCHEDULED',
  resolutionRules: 'Official CEC turnout figure.',
}

describe('runCreationEstimate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOracleConfigMock.mockReturnValue({ baseUrl: 'https://oracle', key: 'k' })
    refreshOracleSnapshotMock.mockResolvedValue({ status: 'ok', sources: 3 })
  })

  it('runs the Oracul on the re-read, classified row with creation provenance', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(baseRow as never)

    await runCreationEstimate('pred-1')

    expect(refreshOracleSnapshotMock).toHaveBeenCalledTimes(1)
    const [row, opts] = refreshOracleSnapshotMock.mock.calls[0]
    // The classified fields must reach retro — they key its forecast cache.
    expect(row).toMatchObject({
      claimDirection: 'UP',
      claimDeadline: baseRow.claimDeadline,
      claimArchetype: 'SCHEDULED',
      resolutionRules: baseRow.resolutionRules,
    })
    expect(opts).toEqual({ origin: 'creation', source: 'creation-estimate', reask: true })
  })

  it('does nothing when the Oracul is not configured', async () => {
    getOracleConfigMock.mockReturnValue(null)
    await runCreationEstimate('pred-1')
    expect(prisma.prediction.findUnique).not.toHaveBeenCalled()
    expect(refreshOracleSnapshotMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a still-DRAFT forecast', { status: 'DRAFT' }],
    ['a moderation-flagged private forecast', { isPublic: false }],
    ['a multiple-choice forecast', { outcomeType: 'MULTIPLE_CHOICE' }],
  ])('skips %s', async (_label, patch) => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({ ...baseRow, ...patch } as never)
    await runCreationEstimate('pred-1')
    expect(refreshOracleSnapshotMock).not.toHaveBeenCalled()
  })

  it('skips a forecast that no longer exists', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)
    await runCreationEstimate('pred-1')
    expect(refreshOracleSnapshotMock).not.toHaveBeenCalled()
  })
})

describe('scheduleCreationEstimate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOracleConfigMock.mockReturnValue({ baseUrl: 'https://oracle', key: 'k' })
  })

  it('never throws into createForecast; a failure is logged', async () => {
    vi.mocked(prisma.prediction.findUnique).mockRejectedValue(new Error('db down'))
    expect(() => scheduleCreationEstimate('pred-1')).not.toThrow()
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalled())
  })
})
