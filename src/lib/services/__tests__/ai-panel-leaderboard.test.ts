import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiMemberScore: { groupBy: vi.fn(), findMany: vi.fn() },
    commitment: { aggregate: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getAiLeaderboard } from '../ai-panel-leaderboard'

const groupBy = vi.mocked(prisma.aiMemberScore.groupBy)
const scoreFindMany = vi.mocked(prisma.aiMemberScore.findMany)
const commitAgg = vi.mocked(prisma.commitment.aggregate)

beforeEach(() => {
  vi.clearAllMocks()
  scoreFindMany.mockResolvedValue([{ commitmentId: 'c1' }] as never)
  commitAgg.mockResolvedValue({ _avg: { brierScore: 0.2 }, _count: { brierScore: 3 } } as never)
})

describe('getAiLeaderboard', () => {
  it('ranks members by mean Brier, ascending (best first), and labels them', async () => {
    groupBy.mockResolvedValue([
      { model: 'x-ai/grok-4.3', _avg: { brierScore: 0.18 }, _count: { brierScore: 12 } },
      { model: 'oracle', _avg: { brierScore: 0.11 }, _count: { brierScore: 12 } },
      { model: 'deepseek/deepseek-chat', _avg: { brierScore: 0.22 }, _count: { brierScore: 12 } },
    ] as never)

    const lb = await getAiLeaderboard()

    expect(lb.members.map((m) => m.label)).toEqual(['Oracle', 'Grok', 'DeepSeek'])
    expect(lb.members[0]).toMatchObject({ isOracle: true, avgBrier: 0.11, count: 12 })
    expect(lb.members[1].isOracle).toBe(false)
  })

  it('omits members below the minimum sample size', async () => {
    groupBy.mockResolvedValue([
      { model: 'x-ai/grok-4.3', _avg: { brierScore: 0.05 }, _count: { brierScore: 2 } }, // lucky, too few
      { model: 'deepseek/deepseek-chat', _avg: { brierScore: 0.2 }, _count: { brierScore: 10 } },
    ] as never)

    const lb = await getAiLeaderboard(5)

    expect(lb.members.map((m) => m.model)).toEqual(['deepseek/deepseek-chat'])
  })

  it('reports the human average on the SAME commitments, for a fair comparison', async () => {
    groupBy.mockResolvedValue([
      { model: 'oracle', _avg: { brierScore: 0.15 }, _count: { brierScore: 8 } },
    ] as never)

    const lb = await getAiLeaderboard()

    expect(lb.humanAvgBrier).toBe(0.2)
    expect(lb.humanCount).toBe(3)
    // Humans were aggregated over exactly the AI-scored commitment ids.
    expect(commitAgg.mock.calls[0]?.[0]?.where?.id).toEqual({ in: ['c1'] })
  })

  it('has no human baseline until a scored commitment exists', async () => {
    groupBy.mockResolvedValue([] as never)
    scoreFindMany.mockResolvedValue([] as never)

    const lb = await getAiLeaderboard()

    expect(lb.members).toEqual([])
    expect(lb.humanAvgBrier).toBeNull()
    expect(commitAgg).not.toHaveBeenCalled()
  })
})
