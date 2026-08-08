/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    articleRatingPrompt: { count: vi.fn() },
    evidencePoolArticleFeedback: { findMany: vi.fn() },
    contextSnapshot: { findMany: vi.fn() },
  },
}))

import { getRatingFeedbackStats } from '../ratingFeedbackStats'
import { prisma } from '@/lib/prisma'

const mockPromptCount = vi.mocked(prisma.articleRatingPrompt.count)
const mockFeedbackFindMany = vi.mocked(prisma.evidencePoolArticleFeedback.findMany)
const mockSnapshotFindMany = vi.mocked(prisma.contextSnapshot.findMany)

const d = (s: string) => new Date(s)

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    createdAt: d('2026-08-01'),
    rating: 5,
    raterName: 'Mark',
    rater: null,
    flaggedFields: [],
    note: null,
    prompt: {
      contextSnapshotId: 'snap-1',
      snapshotSimilarity: 0.5,
      evidencePoolArticle: {
        title: 'Article title',
        url: 'https://x.com/a',
        source: 'Reuters',
        prediction: { id: 'p1', claimText: 'Will X happen?', slug: 'x-happen' },
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPromptCount.mockResolvedValue(10 as never)
  mockSnapshotFindMany.mockResolvedValue([
    { id: 'snap-1', oracleSnapshot: { mean: 71, ciLow: 55, ciHigh: 85, articlesUsed: 4 } },
  ] as never)
})

describe('getRatingFeedbackStats', () => {
  it('computes promptsSent, totalVotes, and responseRate', async () => {
    mockFeedbackFindMany.mockResolvedValue([feedbackRow(), feedbackRow({ id: 'f2' })] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.promptsSent).toBe(10)
    expect(stats.totalVotes).toBe(2)
    expect(stats.responseRate).toBe(20) // 2/10 * 100
  })

  it('returns 0% response rate without dividing by zero when no prompts were sent', async () => {
    mockPromptCount.mockResolvedValue(0 as never)
    mockFeedbackFindMany.mockResolvedValue([] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.responseRate).toBe(0)
  })

  it('builds a 5-bucket rating distribution', async () => {
    mockFeedbackFindMany.mockResolvedValue([
      feedbackRow({ id: 'f1', rating: 1 }),
      feedbackRow({ id: 'f2', rating: 3 }),
      feedbackRow({ id: 'f3', rating: 4 }),
      feedbackRow({ id: 'f4', rating: 4 }),
      feedbackRow({ id: 'f5', rating: 5 }),
    ] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.ratingDistribution).toEqual([1, 0, 1, 2, 1])
  })

  it('groups by-rater stats using raterName, falling back to the linked user', async () => {
    mockFeedbackFindMany.mockResolvedValue([
      feedbackRow({ id: 'f1', raterName: 'Mark', rating: 4 }),
      feedbackRow({ id: 'f2', raterName: 'Mark', rating: 5 }),
      feedbackRow({ id: 'f3', raterName: null, rater: { id: 'u1', name: 'Andrey', username: null }, rating: 2 }),
    ] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.byRater).toEqual([
      { raterName: 'Mark', count: 2, avgRating: 4.5, nonFiveCount: 1 },
      { raterName: 'Andrey', count: 1, avgRating: 2, nonFiveCount: 1 },
    ])
  })

  it('joins the frozen ContextSnapshot oracle numbers by contextSnapshotId', async () => {
    mockFeedbackFindMany.mockResolvedValue([feedbackRow()] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.votes[0].oracle).toEqual({ mean: 71, ciLow: 55, ciHigh: 85, articlesUsed: 4 })
    expect(mockSnapshotFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['snap-1'] } },
      select: { id: true, oracleSnapshot: true },
    })
  })

  it('skips the snapshot lookup and returns null oracle numbers when no prompt has a contextSnapshotId', async () => {
    mockFeedbackFindMany.mockResolvedValue([
      feedbackRow({ prompt: { ...feedbackRow().prompt, contextSnapshotId: null } }),
    ] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.votes[0].oracle).toBeNull()
    expect(mockSnapshotFindMany).not.toHaveBeenCalled()
  })

  it('carries the article, prediction, flaggedFields, and note through to each vote row', async () => {
    mockFeedbackFindMany.mockResolvedValue([
      feedbackRow({ flaggedFields: ['STANCE', 'RELEVANCE'], note: 'looks off' }),
    ] as never)
    const stats = await getRatingFeedbackStats()
    expect(stats.votes[0]).toMatchObject({
      article: { title: 'Article title', url: 'https://x.com/a', source: 'Reuters' },
      prediction: { id: 'p1', claimText: 'Will X happen?', slug: 'x-happen' },
      flaggedFields: ['STANCE', 'RELEVANCE'],
      note: 'looks off',
    })
  })
})
