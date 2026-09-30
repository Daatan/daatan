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
    oracleCallLog: { count: vi.fn() },
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
  classifiedAt: new Date('2026-09-27'),
}

describe('runCreationEstimate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOracleConfigMock.mockReturnValue({ baseUrl: 'https://oracle', key: 'k' })
    refreshOracleSnapshotMock.mockResolvedValue({ status: 'ok', sources: 3 })
    vi.mocked(prisma.oracleCallLog.count).mockResolvedValue(0)
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
    // Published before the classifier finished: the post-classification trigger runs it.
    ['a not-yet-classified forecast', { classifiedAt: null }],
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

  it('does not run twice for a forecast that already has a creation estimate (re-publish)', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(baseRow as never)
    vi.mocked(prisma.oracleCallLog.count).mockResolvedValue(2)
    await runCreationEstimate('pred-1')
    expect(refreshOracleSnapshotMock).not.toHaveBeenCalled()
  })

  it('runs once when publish and the post-classification trigger race', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(baseRow as never)
    await Promise.all([runCreationEstimate('pred-1'), runCreationEstimate('pred-1')])
    expect(refreshOracleSnapshotMock).toHaveBeenCalledTimes(1)
  })

  it('releases the in-flight guard after a failed run', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(baseRow as never)
    refreshOracleSnapshotMock.mockRejectedValueOnce(new Error('boom'))
    await expect(runCreationEstimate('pred-1')).rejects.toThrow('boom')
    await runCreationEstimate('pred-1')
    expect(refreshOracleSnapshotMock).toHaveBeenCalledTimes(2)
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
