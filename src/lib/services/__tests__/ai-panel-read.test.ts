import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { aiEstimate: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { getPanelSeries } from '../ai-panel-read'

const findMany = vi.mocked(prisma.aiEstimate.findMany)

function row(model: string, probability: number | null, iso: string, mode = 'ungrounded') {
  return { model, mode, probability, run: { createdAt: new Date(iso) } }
}

beforeEach(() => vi.clearAllMocks())

describe('getPanelSeries', () => {
  it('queries only real, non-abstained estimates for the prediction', async () => {
    findMany.mockResolvedValue([])
    await getPanelSeries('pred-1')
    const where = findMany.mock.calls[0]?.[0]?.where
    expect(where).toMatchObject({
      run: { predictionId: 'pred-1' },
      insufficientData: false,
      probability: { not: null },
    })
  })

  it('groups estimates into one series per member, oldest first', async () => {
    findMany.mockResolvedValue([
      row('x-ai/grok-4.3', 40, '2026-07-01T00:00:00Z'),
      row('x-ai/grok-4.3', 55, '2026-07-02T00:00:00Z'),
      row('deepseek/deepseek-chat', 30, '2026-07-01T00:00:00Z'),
    ] as never)

    const series = await getPanelSeries('pred-1')

    const grok = series.find((s) => s.model === 'x-ai/grok-4.3')!
    expect(grok.label).toBe('Grok')
    expect(grok.points.map((p) => p.probability)).toEqual([40, 55])
    expect(series.find((s) => s.model === 'deepseek/deepseek-chat')!.label).toBe('DeepSeek')
  })

  it('labels the 4B Gemma as the control', async () => {
    findMany.mockResolvedValue([row('google/gemma-3-4b-it', 50, '2026-07-01T00:00:00Z')] as never)
    const series = await getPanelSeries('pred-1')
    expect(series[0].isControl).toBe(true)
    // gemini is NOT a control despite sharing the Google prefix
    findMany.mockResolvedValue([row('google/gemini-2.5-flash', 50, '2026-07-01T00:00:00Z')] as never)
    expect((await getPanelSeries('pred-1'))[0].isControl).toBe(false)
  })

  it('gives each member a distinct colour', async () => {
    findMany.mockResolvedValue([
      row('x-ai/grok-4.3', 40, '2026-07-01T00:00:00Z'),
      row('deepseek/deepseek-chat', 30, '2026-07-01T00:00:00Z'),
    ] as never)
    const series = await getPanelSeries('pred-1')
    expect(new Set(series.map((s) => s.color)).size).toBe(series.length)
  })

  it('disambiguates a renamed member: the retired series is marked, the current one keeps its label', async () => {
    // The roster comment's own scenario: historical OpenRouter qwen/… rows alongside
    // the current Bedrock qwen.… member — both prefix-label to "Qwen".
    findMany.mockResolvedValue([
      row('qwen.qwen3-235b-a22b-2507-v1:0', 40, '2026-07-02T00:00:00Z'),
      row('qwen/qwen3-235b-a22b-2507', 38, '2026-07-01T00:00:00Z'),
    ] as never)

    const series = await getPanelSeries('pred-1')

    const current = series.find((s) => s.model === 'qwen.qwen3-235b-a22b-2507-v1:0')!
    const retired = series.find((s) => s.model === 'qwen/qwen3-235b-a22b-2507')!
    expect(current.label).toBe('Qwen')
    expect(retired.label).toBe('Qwen (legacy)')
    expect(new Set(series.map((s) => s.label)).size).toBe(2)
  })

  it('splits a grounded twin into its own series with its own label and colour', async () => {
    findMany.mockResolvedValue([
      row('deepseek/deepseek-chat', 30, '2026-07-01T00:00:00Z'),
      row('deepseek/deepseek-chat', 45, '2026-07-01T00:00:00Z', 'grounded-indexer'),
    ] as never)

    const series = await getPanelSeries('pred-1')

    expect(series).toHaveLength(2)
    const plain = series.find((s) => s.mode === 'ungrounded')!
    const grounded = series.find((s) => s.mode === 'grounded-indexer')!
    expect(plain.label).toBe('DeepSeek')
    expect(grounded.label).toBe('DeepSeek (news)')
    expect(grounded.color).not.toBe(plain.color)
    // Neither is "(legacy)": both identities are on a current roster.
    expect(series.some((s) => s.label.includes('legacy'))).toBe(false)
  })
})
