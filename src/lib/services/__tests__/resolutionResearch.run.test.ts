import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/evidence-pool', () => ({
  getPoolArticlesForResearch: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/services/oracleSearch', () => ({ oracleSearch: vi.fn() }))
vi.mock('@/lib/utils/multilingualSearch', () => ({ searchArticlesMultilingual: vi.fn() }))
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn().mockResolvedValue('tpl'),
  fillPrompt: vi.fn().mockReturnValue('prompt'),
}))
vi.mock('@/lib/llm/schemas', () => ({ queryGenerationSchema: {}, researchSchema: {} }))
vi.mock('@/lib/llm/stageModels', () => ({ forStage: vi.fn().mockReturnValue({}) }))

import { oracleSearch } from '@/lib/services/oracleSearch'
import { searchArticlesMultilingual } from '@/lib/utils/multilingualSearch'
import { llmService } from '@/lib/llm'
import { runResolutionResearch } from '@/lib/services/resolutionResearch'

const oracle = vi.mocked(oracleSearch)
const search = vi.mocked(searchArticlesMultilingual)
const generate = vi.mocked(llmService.generateContent)

const hit = (url: string) => ({ title: url, url, snippet: 's', source: 'x', publishedDate: '2026-09-09' })

const prediction = {
  id: 'pred-1',
  claimText: 'Apple will unveil a foldable iPhone at its September 2026 event.',
  outcomeType: 'BINARY',
  resolutionRules: null,
  publishedAt: new Date('2026-08-01T00:00:00Z'),
  createdAt: new Date('2026-08-01T00:00:00Z'),
  resolveByDatetime: new Date('2026-09-30T00:00:00Z'),
  options: [],
}

const verdict = JSON.stringify({ outcome: 'correct', reasoning: 'r', evidenceLinks: [] })

describe('runResolutionResearch — legs run concurrently (#1856)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    search.mockResolvedValue([hit('https://t/1')] as never)
  })

  it('starts query generation while the raw-claim leg is still pending', async () => {
    let releaseOracle!: (v: unknown) => void
    oracle.mockReturnValue(new Promise((res) => { releaseOracle = res }) as never)
    generate.mockImplementation((async (args: { prompt: string }) => ({ text: args.prompt === 'prompt' ? JSON.stringify({ queries: ['q1', 'q2'] }) : verdict })) as never)

    const run = runResolutionResearch(prediction, { userId: 'u1' })
    // Let microtasks run: the raw-claim leg is parked on `oracle`, query generation must already have started.
    await new Promise((r) => setTimeout(r, 0))
    expect(generate).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalled()

    releaseOracle([hit('https://a/1'), hit('https://a/2'), hit('https://a/3')])
    generate.mockResolvedValueOnce({ text: verdict } as never)
    const res = await run
    expect(res.outcome).toBe('correct')
  })

  it('still composes the primary results with the targeted legs', async () => {
    oracle.mockResolvedValue([hit('https://a/1'), hit('https://a/2'), hit('https://a/3')] as never)
    generate
      .mockResolvedValueOnce({ text: JSON.stringify({ queries: ['q1'] }) } as never)
      .mockResolvedValueOnce({ text: verdict } as never)

    await runResolutionResearch(prediction, { userId: 'u1' })

    const verdictCall = generate.mock.calls[1][0] as { prompt: string }
    expect(verdictCall.prompt).toBe('prompt') // fillPrompt mock; composition is covered by composeResearchResults tests
    expect(search).toHaveBeenCalledTimes(2) // 1 query × (deadline window + pre-creation window)
  })

  it('a failing query-generation leg falls back to the raw-claim results', async () => {
    oracle.mockResolvedValue([hit('https://a/1'), hit('https://a/2'), hit('https://a/3')] as never)
    generate
      .mockRejectedValueOnce(new Error('llm down'))
      .mockResolvedValueOnce({ text: verdict } as never)

    const res = await runResolutionResearch(prediction, { userId: 'u1' })
    expect(res.outcome).toBe('correct')
    expect(search).not.toHaveBeenCalled() // oracle returned ≥3, no local fallback, targeted leg failed
  })

  describe('verdict call (#2096)', () => {
    const run = (source?: 'research' | 'born-true-check') => {
      generate.mockReset()
      generate
        .mockResolvedValueOnce({ text: JSON.stringify({ queries: [] }) } as never)
        .mockResolvedValueOnce({ text: verdict } as never)
      return runResolutionResearch(prediction as never, { userId: 'u', source })
    }
    const verdictRequest = () => generate.mock.calls[1][0]

    it('a manual run uses the first leg only, with the longer budget', async () => {
      await run('research')
      expect(verdictRequest()).toMatchObject({ primaryOnly: true, googleTimeoutMs: 75_000 })
    })

    it('the born-true check may still fall back', async () => {
      await run('born-true-check')
      expect(verdictRequest()).toMatchObject({ primaryOnly: false, googleTimeoutMs: 75_000 })
    })

    it('a verdict without evidenceLinks gets an empty list, and its leg is reported', async () => {
      generate.mockReset()
      generate
        .mockResolvedValueOnce({ text: JSON.stringify({ queries: [] }) } as never)
        .mockResolvedValueOnce({ text: JSON.stringify({ outcome: 'correct', reasoning: 'r' }), fallbackProvider: 'Oracul' } as never)

      const res = await runResolutionResearch(prediction as never, { userId: 'u', source: 'born-true-check' })

      expect(res.evidenceLinks).toEqual([])
      expect(res.fallbackProvider).toBe('Oracul')
    })

    it('rejects a verdict with an unknown outcome', async () => {
      generate.mockReset()
      generate
        .mockResolvedValueOnce({ text: JSON.stringify({ queries: [] }) } as never)
        .mockResolvedValueOnce({ text: JSON.stringify({ outcome: 'maybe', reasoning: 'r', evidenceLinks: [] }) } as never)

      await expect(runResolutionResearch(prediction as never, { userId: 'u' })).rejects.toThrow()
    })
  })

  it('propagates a raw-claim leg failure, as before', async () => {
    oracle.mockRejectedValue(new Error('oracle down'))
    generate.mockResolvedValue({ text: JSON.stringify({ queries: [] }) } as never)
    await expect(runResolutionResearch(prediction, { userId: 'u1' })).rejects.toThrow('oracle down')
  })
})

describe('runResolutionResearch — premature verdicts (#2076)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    search.mockResolvedValue([hit('https://t/1')] as never)
    oracle.mockResolvedValue([hit('https://a/1'), hit('https://a/2'), hit('https://a/3')] as never)
  })

  it('forces outcome to unresolvable when the model flags premature', async () => {
    generate.mockImplementation((async () => ({
      text: JSON.stringify({ outcome: 'wrong', premature: true, reasoning: 'too early', evidenceLinks: [] }),
    })) as never)
    const res = await runResolutionResearch(prediction, { userId: 'u1' })
    expect(res.outcome).toBe('unresolvable')
    expect(res.premature).toBe(true)
  })

  it('passes a computed deadline status to the prompt', async () => {
    const { fillPrompt } = await import('@/lib/llm/bedrock-prompts')
    generate.mockImplementation((async () => ({ text: verdict })) as never)
    await runResolutionResearch(prediction, { userId: 'u1' })
    const vars = vi.mocked(fillPrompt).mock.calls.map(([, v]) => v).find((v) => 'deadlineStatus' in v)
    expect(vars?.deadlineStatus).toMatch(/^(PASSED|NOT YET PASSED)/)
  })
})

describe('deadlineStatus', () => {
  it('reports days remaining before the deadline and PASSED after it', async () => {
    const { deadlineStatus } = await import('@/lib/services/resolutionResearch')
    const now = new Date('2026-11-01T15:20:00Z')
    expect(deadlineStatus(new Date('2026-12-31T23:59:59Z'), now)).toBe('NOT YET PASSED — 61 days remain until the deadline.')
    expect(deadlineStatus(new Date('2026-11-02T00:00:00Z'), now)).toBe('NOT YET PASSED — 1 day remains until the deadline.')
    expect(deadlineStatus(new Date('2026-10-31T00:00:00Z'), now)).toBe('PASSED — the claim window is closed.')
  })
})
