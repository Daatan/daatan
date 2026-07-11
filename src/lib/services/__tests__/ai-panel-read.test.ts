import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { aiEstimate: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { getPanelSeries } from '../ai-panel-read'

const findMany = vi.mocked(prisma.aiEstimate.findMany)

function row(model: string, probability: number | null, iso: string) {
  return { model, probability, run: { createdAt: new Date(iso) } }
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
})
