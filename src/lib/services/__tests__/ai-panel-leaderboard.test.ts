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
      { model: 'x-ai/grok-4.3', mode: 'ungrounded', promptVersion: 'pv1', _avg: { brierScore: 0.18 }, _count: { brierScore: 12 } },
      { model: 'oracle', mode: 'sentinel', promptVersion: null, _avg: { brierScore: 0.11 }, _count: { brierScore: 12 } },
      { model: 'deepseek/deepseek-chat', mode: 'ungrounded', promptVersion: 'pv1', _avg: { brierScore: 0.22 }, _count: { brierScore: 12 } },
    ] as never)

    const lb = await getAiLeaderboard()

    expect(lb.members.map((m) => m.label)).toEqual(['Oracle', 'Grok', 'DeepSeek'])
    expect(lb.members[0]).toMatchObject({ isOracle: true, avgBrier: 0.11, count: 12 })
    expect(lb.members[1].isOracle).toBe(false)
    // Member identity includes the prompt version (docs/LASSO.md §6): the aggregation
    // must never average scores produced under different prompt templates.
    expect(groupBy.mock.calls[0]?.[0]?.by).toEqual(['model', 'mode', 'promptVersion'])
  })

  it('keeps prompt versions as separate rows, disambiguating the label only then', async () => {
    groupBy.mockResolvedValue([
      { model: 'x-ai/grok-4.3', mode: 'ungrounded', promptVersion: '261acc6e2592', _avg: { brierScore: 0.18 }, _count: { brierScore: 12 } },
      { model: 'x-ai/grok-4.3', mode: 'ungrounded', promptVersion: 'f00dfeed1234', _avg: { brierScore: 0.12 }, _count: { brierScore: 9 } },
      { model: 'deepseek/deepseek-chat', mode: 'ungrounded', promptVersion: '261acc6e2592', _avg: { brierScore: 0.2 }, _count: { brierScore: 12 } },
    ] as never)

    const lb = await getAiLeaderboard()

    // Two Grok rows — never merged — each labelled with its prompt fingerprint; the
    // single-version DeepSeek keeps its plain label.
    expect(lb.members.map((m) => m.label)).toEqual([
      'Grok · f00dfe',
      'Grok · 261acc',
      'DeepSeek',
    ])
    expect(lb.members.map((m) => m.promptVersion)).toEqual([
      'f00dfeed1234',
      '261acc6e2592',
      '261acc6e2592',
    ])
  })

  it('keeps a grounded twin as its own row, labelled "(news)" — never averaged with its sibling', async () => {
    groupBy.mockResolvedValue([
      { model: 'deepseek/deepseek-chat', mode: 'ungrounded', promptVersion: 'pv1', _avg: { brierScore: 0.22 }, _count: { brierScore: 12 } },
      { model: 'deepseek/deepseek-chat', mode: 'grounded-indexer', promptVersion: 'pv2', _avg: { brierScore: 0.15 }, _count: { brierScore: 12 } },
    ] as never)

    const lb = await getAiLeaderboard()

    expect(lb.members.map((m) => m.label)).toEqual(['DeepSeek (news)', 'DeepSeek'])
    expect(lb.members.map((m) => m.mode)).toEqual(['grounded-indexer', 'ungrounded'])
    // One prompt version per (model, mode): no fingerprint suffix needed on either.
    expect(lb.members.some((m) => m.label.includes('·'))).toBe(false)
  })

  it('labels and flags the market benchmark, ranked inline with the models', async () => {
    groupBy.mockResolvedValue([
      { model: 'x-ai/grok-4.3', mode: 'ungrounded', promptVersion: 'pv1', _avg: { brierScore: 0.2 }, _count: { brierScore: 12 } },
      { model: 'market', mode: 'sentinel', promptVersion: null, _avg: { brierScore: 0.14 }, _count: { brierScore: 7 } },
    ] as never)

    const lb = await getAiLeaderboard()

    const market = lb.members.find((m) => m.model === 'market')!
    expect(market).toMatchObject({ label: 'Market', isMarket: true, isOracle: false })
    // Better Brier ⇒ ranked above Grok, so you can see which models beat the market.
    expect(lb.members[0].model).toBe('market')
    expect(lb.members.find((m) => m.model === 'x-ai/grok-4.3')!.isMarket).toBe(false)
  })

  it('omits members below the minimum sample size', async () => {
    groupBy.mockResolvedValue([
      { model: 'x-ai/grok-4.3', mode: 'ungrounded', promptVersion: 'pv1', _avg: { brierScore: 0.05 }, _count: { brierScore: 2 } }, // lucky, too few
      { model: 'deepseek/deepseek-chat', mode: 'ungrounded', promptVersion: 'pv1', _avg: { brierScore: 0.2 }, _count: { brierScore: 10 } },
    ] as never)

    const lb = await getAiLeaderboard(5)

    expect(lb.members.map((m) => m.model)).toEqual(['deepseek/deepseek-chat'])
  })

  it('reports the human average on the SAME commitments, for a fair comparison', async () => {
    groupBy.mockResolvedValue([
      { model: 'oracle', mode: 'sentinel', promptVersion: null, _avg: { brierScore: 0.15 }, _count: { brierScore: 8 } },
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
