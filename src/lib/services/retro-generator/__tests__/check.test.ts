import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { llmService } from '@/lib/llm'
import { retroEventCheckSchema } from '@/lib/llm/schemas'
import type { NewsBeforeArticle } from '@/lib/services/news-indexer'
import { STAGES } from '@/lib/llm/registry'
import { buildEventCheckPrompt, checkRetroEvent, CHECK_TIMEOUT_MS, validateEventCheck, type EventCheckInput, type NearForecast } from '../check'

const article = (url: string, title: string, snippet: string | null = 'snip', text: string | null = 'body'): NewsBeforeArticle => ({
  title, url, snippet, source: 'x.com', language: 'en', published_date: '2026-11-01',
  published_at: '2026-11-01T09:00:00Z', published_at_source: 'meta', indexed_at: '2026-11-01T09:00:00Z', similarity: 0.5, text,
})
const articles = [article('https://a.com/1', 'Speaker race heats up'), article('https://b.com/2', 'Unrelated chip story'), article('https://c.com/3', 'Kahana elected')]
const near: NearForecast[] = [
  { id: 'p1', claimText: 'The Knesset Speaker will be changed by December 9, 2026.', createdAt: new Date('2026-11-09T10:00:00Z'), status: 'RESOLVED_CORRECT', retro: false, score: 0.903 },
  { id: 'p2', claimText: 'The Israeli parliament will be dissolved by July 15, 2026.', createdAt: new Date('2026-07-03T10:00:00Z'), status: 'RESOLVED_WRONG', retro: false, score: 0.851 },
]
const input: EventCheckInput = {
  eventSummary: 'Matan Kahana was elected as the Knesset Speaker.',
  claimText: 'Matan Kahana will be elected as the Knesset Speaker by November 30, 2026.',
  asOf: new Date('2026-11-09T00:00:00Z'),
  articles,
  near,
}
const answer = {
  articles: [
    { n: 1, onTopic: true, reportsEvent: false },
    { n: 2, onTopic: false, reportsEvent: false },
    { n: 3, onTopic: true, reportsEvent: true },
  ],
  sameEventAs: 1,
  reason: 'Forecast 1 is settled by the election.',
}

describe('validateEventCheck', () => {
  it('maps each verdict to its article and the forecast number to the forecast', () => {
    const r = validateEventCheck(answer, articles, near)
    expect(r).toEqual({
      ok: true,
      verdicts: [
        { url: 'https://a.com/1', onTopic: true, reportsEvent: false },
        { url: 'https://b.com/2', onTopic: false, reportsEvent: false },
        { url: 'https://c.com/3', onTopic: true, reportsEvent: true },
      ],
      sameEventAs: near[0],
      reason: 'Forecast 1 is settled by the election.',
    })
  })

  it('reads 0, an out-of-range number or junk as no duplicate', () => {
    for (const sameEventAs of [0, 3, -1, 1.5, 'x', null]) {
      const r = validateEventCheck({ ...answer, sameEventAs }, articles, near)
      expect(r.ok && r.sameEventAs).toBe(null)
    }
    const empty = validateEventCheck({ ...answer, sameEventAs: 1 }, articles, [])
    expect(empty.ok && empty.sameEventAs).toBe(null)
  })

  it('refuses an answer that leaves an article out: it could be the one that reports the event', () => {
    const r = validateEventCheck({ ...answer, articles: answer.articles.slice(0, 2) }, articles, near)
    expect(r).toEqual({ ok: false, reason: 'event_check_incomplete', detail: '2/3 articles judged' })
    // A repeated or out-of-range number does not stand in for a missing one.
    const padded = [...answer.articles.slice(0, 2), { n: 2, onTopic: true, reportsEvent: true }, { n: 4, onTopic: true, reportsEvent: false }]
    expect(validateEventCheck({ ...answer, articles: padded }, articles, near)).toMatchObject({ ok: false, reason: 'event_check_incomplete' })
    expect(validateEventCheck({ ...answer, articles: 'none' }, articles, near)).toMatchObject({ ok: false, reason: 'event_check_incomplete' })
  })

  it('takes only literal true as yes', () => {
    const r = validateEventCheck({ ...answer, articles: answer.articles.map((a) => ({ ...a, onTopic: 'true', reportsEvent: 1 })) }, articles, near)
    expect(r.ok && r.verdicts.every((v) => !v.onTopic && !v.reportsEvent)).toBe(true)
  })
})

describe('buildEventCheckPrompt', () => {
  it('numbers the articles and forecasts and puts both inside their tags', async () => {
    const long = article('https://d.com/4', 'Long one', `  first\n\n  line ${'x'.repeat(500)}`)
    const p = await buildEventCheckPrompt({ ...input, articles: [...articles, long] })
    expect(p).toContain('as of 2026-11-09')
    expect(p).toContain('Matan Kahana was elected as the Knesset Speaker.')
    expect(p).toContain('[1] 2026-11-01 · x.com — Speaker race heats up\n    snip')
    expect(p).toMatch(/\[4\] 2026-11-01 · x\.com — Long one\n {4}first line x{389}\n/)
    expect(p).toContain('[1] asked 2026-11-09: The Knesset Speaker will be changed by December 9, 2026.')
    expect(p.indexOf('<articles>')).toBeLessThan(p.indexOf('Speaker race heats up'))
    expect(p.indexOf('</existing_forecasts>')).toBeGreaterThan(p.indexOf('[2] asked 2026-07-03'))
    expect(p).not.toMatch(/\{\{\w+\}\}/)
  })

  it('falls back to the text for the excerpt, and to the title alone', async () => {
    const p = await buildEventCheckPrompt({
      ...input,
      articles: [article('https://a.com/1', 'With text', null, 'the body'), article('https://b.com/2', 'Bare', '', null)],
      near: [],
    })
    expect(p).toContain('With text\n    the body')
    expect(p).toContain('[2] 2026-11-01 · x.com — Bare\n</articles>')
    expect(p).toContain('<existing_forecasts>\n(none)\n</existing_forecasts>')
  })
})

describe('checkRetroEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks the retro_event_check stage at temperature 0 with its schema', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: JSON.stringify(answer) })
    const r = await checkRetroEvent(input)
    expect(r).toMatchObject({ ok: true, sameEventAs: near[0] })
    const req = vi.mocked(llmService.generateContent).mock.calls[0][0]
    expect(req).toMatchObject({ stage: 'retro_event_check', temperature: 0, schema: retroEventCheckSchema })
    expect(req.signal).toBeInstanceOf(AbortSignal)
  })

  it('caps the Google leg below the whole budget, so a fallback still has time (daatan#2229)', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: JSON.stringify(answer) })
    await checkRetroEvent(input)
    const req = vi.mocked(llmService.generateContent).mock.calls[0][0]
    expect(req.googleTimeoutMs).toBe(STAGES.retro_event_check.timeoutMs)
    expect(CHECK_TIMEOUT_MS - STAGES.retro_event_check.timeoutMs!).toBeGreaterThanOrEqual(10_000)
  })

  it('notes a fallback model', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: JSON.stringify(answer), fallbackProvider: 'openrouter' })
    expect(await checkRetroEvent(input)).toMatchObject({ ok: true, modelNote: 'answered by openrouter' })
  })

  it('fails closed on a model error or unparseable answer, and says which', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValueOnce(new Error('quota'))
    expect(await checkRetroEvent(input)).toEqual({ ok: false, reason: 'event_check_failed', detail: 'quota' })
    vi.mocked(llmService.generateContent).mockResolvedValueOnce({ text: 'not json' })
    expect(await checkRetroEvent(input)).toMatchObject({ ok: false, reason: 'event_check_failed', detail: expect.stringContaining('JSON') })
  })

  it('names a timeout as one', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(AbortSignal.abort())
    try {
      vi.mocked(llmService.generateContent).mockRejectedValueOnce(new Error('LLM call aborted by caller'))
      expect(await checkRetroEvent(input)).toEqual({ ok: false, reason: 'event_check_failed', detail: 'timeout after 35 s' })
      expect(timeout).toHaveBeenCalledWith(CHECK_TIMEOUT_MS)
    } finally {
      timeout.mockRestore()
    }
  })
})
