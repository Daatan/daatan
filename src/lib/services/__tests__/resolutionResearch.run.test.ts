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

  it('propagates a raw-claim leg failure, as before', async () => {
    oracle.mockRejectedValue(new Error('oracle down'))
    generate.mockResolvedValue({ text: JSON.stringify({ queries: [] }) } as never)
    await expect(runResolutionResearch(prediction, { userId: 'u1' })).rejects.toThrow('oracle down')
  })
})
