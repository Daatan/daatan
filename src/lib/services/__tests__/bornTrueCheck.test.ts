/**
 * daatan#1747: the born-true check re-runs the resolver's research leg right
 * after a forecast is created and flags to Telegram when it comes back
 * decisive — catching a claim that was already true/false against
 * present-day reality before the forecast ever went live (retro#776, the
 * Chess.com 500k-users incident).
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

const aiResearchEnabledMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/capabilities', () => ({
  aiResearchEnabled: () => aiResearchEnabledMock(),
}))

const runResolutionResearchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/resolutionResearch', () => ({
  runResolutionResearch: (...args: unknown[]) => runResolutionResearchMock(...args),
}))

const notifyBornTrueAtCreationMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/telegram', () => ({
  notifyBornTrueAtCreation: (...args: unknown[]) => notifyBornTrueAtCreationMock(...args),
}))

import { prisma } from '@/lib/prisma'
import { checkBornTrueAtCreation, scheduleBornTrueCheck } from '@/lib/services/bornTrueCheck'

const basePrediction = {
  id: 'pred-1',
  authorId: 'author-1',
  claimText: 'Chess.com will have more than 500,000 registered users by Dec 31 2030',
  slug: 'chess-com-users',
  outcomeType: 'BINARY',
  resolutionRules: null,
  publishedAt: null,
  createdAt: new Date('2026-01-01'),
  resolveByDatetime: new Date('2030-12-31'),
  options: [],
}

describe('checkBornTrueAtCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiResearchEnabledMock.mockReturnValue(true)
  })

  it('does nothing when AI research is disabled on this instance', async () => {
    aiResearchEnabledMock.mockReturnValue(false)

    await checkBornTrueAtCreation('pred-1')

    expect(prisma.prediction.findUnique).not.toHaveBeenCalled()
    expect(runResolutionResearchMock).not.toHaveBeenCalled()
  })

  it('does nothing when the prediction no longer exists', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(null)

    await checkBornTrueAtCreation('missing')

    expect(runResolutionResearchMock).not.toHaveBeenCalled()
  })

  it('flags to Telegram when the research leg comes back "correct" (born-true)', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    runResolutionResearchMock.mockResolvedValue({
      outcome: 'correct',
      reasoning: 'Chess.com already reports 250M+ registered users.',
      evidenceLinks: ['https://chess.com/about'],
      timings: { searchMs: 1, llmMs: 1, totalMs: 2 },
    })

    await checkBornTrueAtCreation('pred-1')

    expect(runResolutionResearchMock).toHaveBeenCalledWith(
      basePrediction,
      { userId: 'author-1', source: 'born-true-check' },
    )
    expect(notifyBornTrueAtCreationMock).toHaveBeenCalledWith(
      { id: 'pred-1', claimText: basePrediction.claimText, slug: 'chess-com-users' },
      'correct',
      'Chess.com already reports 250M+ registered users.',
      ['https://chess.com/about'],
    )
  })

  it('flags to Telegram when the research leg comes back "wrong" (born-false)', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    runResolutionResearchMock.mockResolvedValue({
      outcome: 'wrong',
      reasoning: 'Already reported as cancelled.',
      evidenceLinks: [],
      timings: { searchMs: 1, llmMs: 1, totalMs: 2 },
    })

    await checkBornTrueAtCreation('pred-1')

    expect(notifyBornTrueAtCreationMock).toHaveBeenCalledOnce()
  })

  it('does not flag an "unresolvable" verdict — that is the normal, unresolved case', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    runResolutionResearchMock.mockResolvedValue({
      outcome: 'unresolvable',
      reasoning: 'No decisive evidence either way.',
      evidenceLinks: [],
      timings: { searchMs: 1, llmMs: 1, totalMs: 2 },
    })

    await checkBornTrueAtCreation('pred-1')

    expect(notifyBornTrueAtCreationMock).not.toHaveBeenCalled()
  })

  it('does not flag a "void" verdict', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(basePrediction as never)
    runResolutionResearchMock.mockResolvedValue({
      outcome: 'void',
      reasoning: 'Event cancelled.',
      evidenceLinks: [],
      timings: { searchMs: 1, llmMs: 1, totalMs: 2 },
    })

    await checkBornTrueAtCreation('pred-1')

    expect(notifyBornTrueAtCreationMock).not.toHaveBeenCalled()
  })
})

describe('scheduleBornTrueCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiResearchEnabledMock.mockReturnValue(true)
  })

  it('never throws — logs and swallows a failure instead (fire-and-forget)', async () => {
    vi.mocked(prisma.prediction.findUnique).mockRejectedValue(new Error('db down'))

    expect(() => scheduleBornTrueCheck('pred-1')).not.toThrow()

    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce())
    expect(errorLog.mock.calls[0][1]).toBe('born-true check failed')
  })
})
