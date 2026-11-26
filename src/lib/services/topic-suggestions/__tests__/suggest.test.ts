import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/lib/services/embedding', () => ({ embedTexts: vi.fn() }))
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/llm/expressPrediction', () => ({
  getDefaultHorizon: () => ({ iso: '2027-12-31T23:59:59Z', human: 'December 31, 2027', year: 2027 }),
}))
vi.mock('@/lib/services/retro-generator/check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/retro-generator/check')>()),
  findNearForecasts: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { embedTexts } from '@/lib/services/embedding'
import { llmService } from '@/lib/llm'
import { findNearForecasts } from '@/lib/services/retro-generator/check'
import type { PoolReport } from '@/lib/services/retro-generator/types'
import {
  findTopicSuggestions,
  renderSuggestPrompt,
  validateSuggestions,
  MAX_SUGGESTIONS,
  SUGGEST_DEFAULTS,
  type OpenForecast,
  type SuggestionGroup,
} from '../suggest'

const now = new Date('2026-11-24T12:00:00Z')
const report = (url: string, source: string, claim: string, publishedDate = '2026-11-22T10:00:00Z'): PoolReport => ({
  url, source, publishedDate, claim, quote: null,
})
const groups: SuggestionGroup[] = [
  { sources: 2, reports: [report('https://a.com/1', 'a.com', 'Eisenkot invited Likud to talks'), report('https://b.com/2', 'b.com', 'Eisenkot invited Likud to talks', '2026-11-23T10:00:00Z')] },
  { sources: 2, reports: [report('https://c.com/3', 'c.com', 'Likud refused to exclude Ben Gvir'), report('https://d.com/4', 'd.com', 'Likud refused to exclude Ben Gvir')] },
  { sources: 3, reports: [report('https://e.com/5', 'e.com', 'The S&P 500 fell 8.6% in a week')] },
]
const forecasts: OpenForecast[] = [
  { id: 'f1', claimText: 'Benjamin Netanyahu will form the next government in Israel by December 31, 2026.', resolveByDatetime: new Date('2026-12-31T23:59:59Z') },
]
const question = (over: Record<string, unknown> = {}) => ({
  claim: 'Gadi Eisenkot will ask the President for an extension of his mandate by {DEADLINE}.',
  deadline: '2026-12-20',
  resolutionRules: 'YES if the President grants or Eisenkot requests an extension by {DEADLINE}. NO otherwise.',
  coveredBy: 0,
  reason: 'The mandate runs out soon.',
  ...over,
})

describe('validateSuggestions', () => {
  it('fills the deadline into claim and rules and counts the story across its groups', () => {
    const out = validateSuggestions({ stories: [{ title: 'Coalition', groups: [1, 2], questions: [question()] }] }, groups, forecasts, now)
    expect(out.stories).toEqual([{ title: 'Coalition', groups: [1, 2], sources: 4 }])
    expect(out.suggestions).toHaveLength(1)
    const s = out.suggestions[0]
    expect(s.claimText).toBe('Gadi Eisenkot will ask the President for an extension of his mandate by December 20, 2026.')
    expect(s.resolutionRules).toContain('by December 20, 2026.')
    expect(s.resolveByDatetime).toBe('2026-12-20T23:59:59.000Z')
    expect(s.sources).toBe(4)
    // Newest first, one per article.
    expect(s.urls[0]).toBe('https://b.com/2')
    expect(new Set(s.urls).size).toBe(4)
  })

  it('reports a question an open forecast already asks instead of suggesting it', () => {
    const out = validateSuggestions({ stories: [{ title: 'Coalition', groups: [1], questions: [question({ coveredBy: 1, claim: '' })] }] }, groups, forecasts, now)
    expect(out.suggestions).toEqual([])
    expect(out.skipped).toEqual([expect.objectContaining({ reason: 'covered_by_forecast', story: 'Coalition', detail: expect.stringContaining('f1') })])
  })

  it.each([
    ['no_deadline_token', { claim: 'Eisenkot will ask for an extension by December 20, 2026.' }],
    ['bad_deadline', { deadline: '2026-02-30' }],
    ['bad_deadline', { deadline: 'end of December' }],
    ['deadline_out_of_range', { deadline: '2026-11-26' }],
    ['deadline_out_of_range', { deadline: '2035-01-01' }],
    ['no_rules', { resolutionRules: ' ' }],
    ['claim_too_long', { claim: `${'x'.repeat(490)} by {DEADLINE}.` }],
    ['non_event_wording', { claim: 'Iran will cease all missile and drone attacks on Bahrain by {DEADLINE}.' }],
    ['non_event_wording', { claim: 'Matan Kahana will remain Knesset speaker by {DEADLINE}.' }],
    ['non_event_wording', { claim: "Gadi Eisenkot's mandate will expire without a government by {DEADLINE}." }],
    ['non_event_wording', { claim: 'Iran will not attack Bahrain for 30 consecutive days by {DEADLINE}.' }],
    ['non_event_wording', { claim: 'The S&P 500 will close lower for ten consecutive trading days by {DEADLINE}.' }],
  ])('skips a question with %s', (reason, over) => {
    const out = validateSuggestions({ stories: [{ title: 'Coalition', groups: [1], questions: [question(over)] }] }, groups, forecasts, now)
    expect(out.suggestions).toEqual([])
    expect(out.skipped.map((s) => s.reason)).toEqual([reason])
  })

  it('keeps a claim where the non-event word is only part of another word', () => {
    const out = validateSuggestions({ stories: [{ title: 'Hostages', groups: [1], questions: [question({ claim: 'The remaining hostages will be released by {DEADLINE}.' })] }] }, groups, forecasts, now)
    expect(out.suggestions).toHaveLength(1)
  })

  it('gives a group to the first story that claims it, and drops a story left with none', () => {
    const out = validateSuggestions({
      stories: [
        { title: 'Coalition', groups: [1, 2], questions: [] },
        { title: 'Ben Gvir', groups: [2, 99], questions: [question()] },
        { title: 'Markets', groups: [3, 3], questions: [] },
      ],
    }, groups, forecasts, now)
    expect(out.stories.map((s) => [s.title, s.groups])).toEqual([['Coalition', [1, 2]], ['Markets', [3]]])
    expect(out.skipped).toEqual([{ reason: 'story_no_groups', story: 'Ben Gvir' }])
    expect(out.suggestions).toEqual([])
  })

  it('keeps at most three questions per story and twelve per run', () => {
    const many = Array.from({ length: 5 }, (_, i) => question({ claim: `Question ${i} will happen by {DEADLINE}.` }))
    const perStory = validateSuggestions({ stories: [{ title: 'Coalition', groups: [1], questions: many }] }, groups, forecasts, now)
    expect(perStory.suggestions).toHaveLength(3)
    expect(perStory.skipped.map((s) => s.reason)).toEqual(['story_cap', 'story_cap'])

    const wide = Array.from({ length: 30 }, (_, i) => ({ sources: 2, reports: [report(`https://x.com/${i}`, `x${i}.com`, `c${i}`)] }))
    const stories = wide.map((_, i) => ({ title: `S${i}`, groups: [i + 1], questions: [question()] }))
    const perRun = validateSuggestions({ stories }, wide, forecasts, now)
    expect(perRun.suggestions).toHaveLength(MAX_SUGGESTIONS)
    expect(perRun.skipped.filter((s) => s.reason === 'run_cap')).toHaveLength(30 - MAX_SUGGESTIONS)
  })

  it('treats a malformed answer as no stories', () => {
    expect(validateSuggestions({ stories: 'nope' }, groups, forecasts, now)).toEqual({ stories: [], suggestions: [], skipped: [] })
  })
})

describe('renderSuggestPrompt', () => {
  it('offers a step deadline at the end of the month about three months out', () => {
    const out = renderSuggestPrompt('{{today}}|{{minDeadline}}|{{stepDeadline}}|{{defaultDeadline}}', groups, forecasts, now)
    expect(out).toBe('2026-11-24|2026-12-01|2027-02-28|2027-12-31')
  })
})

describe('findTopicSuggestions', () => {
  const poolRow = (url: string, source: string, claim: string) => ({ url, source, published_date: '2026-11-22T10:00:00Z', claim, quote: null })
  const poolRows = [
    poolRow('https://a.com/1', 'a.com', 'Eisenkot invited Likud to coalition talks'),
    poolRow('https://b.com/2', 'b.com', 'Eisenkot invited Likud to coalition talks'),
    poolRow('https://c.com/3', 'c.com', 'Bitcoin ETFs saw seven sessions of outflows'),
  ]
  const vec = (text: string) => (text.startsWith('Eisenkot') ? [1, 0] : [0, 1])
  const opts = { ...SUGGEST_DEFAULTS, now }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(embedTexts).mockImplementation(async (texts) => texts.map(vec))
    vi.mocked(findNearForecasts).mockResolvedValue([])
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(poolRows).mockResolvedValueOnce(forecasts)
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: JSON.stringify({ stories: [{ title: 'Coalition', groups: [1], questions: [question()] }] }),
    } as never)
  })

  it('sends only multi-source clusters, with the open forecasts they touch, and returns the suggestion', async () => {
    const out = await findTopicSuggestions(opts)
    expect(out).toMatchObject({ claims: 3, reports: 3, clusters: 2, multiSource: 1, sent: 1, openForecasts: 1 })
    expect(out.suggestions.map((s) => s.claimText)).toEqual(['Gadi Eisenkot will ask the President for an extension of his mandate by December 20, 2026.'])
    const prompt = vi.mocked(llmService.generateContent).mock.calls[0][0].prompt
    expect(prompt).toContain('[1] 2 outlets')
    expect(prompt).not.toContain('Bitcoin')
    expect(prompt).toContain('[1] (resolves by 2026-12-31) Benjamin Netanyahu will form the next government')
    expect(prompt).toContain('2027-12-31')
    expect(prompt).toContain('2026-12-01')
  })

  it('drops a near-copy of an existing forecast and shows a merely close one', async () => {
    vi.mocked(findNearForecasts).mockResolvedValueOnce([{ id: 'f9', claimText: 'Eisenkot will get a mandate extension', createdAt: now, status: 'ACTIVE', retro: false, score: 0.97 }])
    const dup = await findTopicSuggestions(opts)
    expect(dup.suggestions).toEqual([])
    expect(dup.skipped).toEqual([expect.objectContaining({ reason: 'near_duplicate', detail: expect.stringContaining('f9') })])

    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(poolRows).mockResolvedValueOnce(forecasts)
    vi.mocked(findNearForecasts).mockResolvedValueOnce([{ id: 'f8', claimText: 'Eisenkot will form a government', createdAt: now, status: 'ACTIVE', retro: false, score: 0.9 }])
    const close = await findTopicSuggestions(opts)
    expect(close.suggestions[0].nearest).toEqual({ id: 'f8', claimText: 'Eisenkot will form a government', status: 'ACTIVE', score: 0.9 })
  })

  it('makes no model call when no cluster has two outlets', async () => {
    vi.mocked(prisma.$queryRaw).mockReset().mockResolvedValueOnce([poolRows[2]])
    const out = await findTopicSuggestions(opts)
    expect(out.sent).toBe(0)
    expect(llmService.generateContent).not.toHaveBeenCalled()
  })

  it('reports a failed model call instead of throwing', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValueOnce(new Error('timeout'))
    const out = await findTopicSuggestions(opts)
    expect(out.suggestions).toEqual([])
    expect(out.skipped).toEqual([{ reason: 'suggest_error', story: '', detail: 'timeout' }])
  })

  it('gives the model call what is left of the run budget', async () => {
    await findTopicSuggestions(opts)
    const signal = vi.mocked(llmService.generateContent).mock.calls[0][0].signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
  })

  it('notes a fallback provider', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce({
      text: JSON.stringify({ stories: [] }),
      fallbackProvider: 'oracle',
    } as never)
    const out = await findTopicSuggestions(opts)
    expect(out.modelNote).toBe('answered by oracle')
  })
})
