import { describe, it, expect, vi, beforeEach } from 'vitest'

const tx = { prediction: { create: vi.fn() }, retroSimulation: { create: vi.fn() } }
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    retroSimulation: { findFirst: vi.fn() },
    prediction: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/lib/services/embedding', () => ({ embedText: vi.fn(), storeForecastEmbedding: vi.fn() }))
vi.mock('@/lib/services/news-indexer', () => ({ searchNewsBefore: vi.fn() }))
vi.mock('@/lib/services/oracle', () => ({ getOraculForecast: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { embedText, storeForecastEmbedding } from '@/lib/services/embedding'
import { searchNewsBefore, type NewsBeforeArticle } from '@/lib/services/news-indexer'
import { getOraculForecast, type OracleForecastResponse } from '@/lib/services/oracle'
import { evidenceQuery, simulateRetroEvent, type SimulateInput } from '../simulate'

const now = new Date('2026-11-17T12:00:00Z')
const input: SimulateInput = {
  reports: [
    { url: 'https://a.com/1', source: 'a.com', publishedDate: '2026-11-10T15:00:00Z', claim: 'Herzog tasked Eisenkot', quote: null },
    { url: 'https://b.com/2', source: 'b.com', publishedDate: '2026-11-11T08:00:00Z', claim: 'Eisenkot got the mandate', quote: null },
  ],
  event: { summary: 'Herzog tasked Eisenkot.', date: '2026-11-10', url: 'https://b.com/2', reason: 'one act' },
  claimTemplate: "Israel's President will task Gadi Eisenkot with forming the next government by {DEADLINE}.",
  rulesTemplate: 'YES if he is tasked by {DEADLINE}. NO otherwise.',
  dryRun: true,
  now,
}
const claimText = "Israel's President will task Gadi Eisenkot with forming the next government by November 30, 2026."

const article = (url: string, published_at: string, text: string | null = 'body'): NewsBeforeArticle => ({
  title: `T ${url}`, url, snippet: 'snip', source: 'x.com', language: 'en', published_date: published_at.slice(0, 10),
  published_at, published_at_source: 'meta', indexed_at: published_at, similarity: 0.7, text,
})
const forecast = {
  mean: 0.2, articles_used: 2, std: 0.1, ci_low: 0, ci_high: 0.4, placeholder: false, question: claimText,
  sources: [{ source_id: 's', source_name: 'x.com', url: 'https://x.com/1', stance: 0.4, certainty: 0.8, credibility_weight: 1, claims: ['c'] }],
} as OracleForecastResponse

describe('simulateRetroEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(embedText).mockResolvedValue([0.1, 0.2])
    vi.mocked(prisma.retroSimulation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])
    vi.mocked(searchNewsBefore).mockResolvedValue([
      article('https://x.com/1', '2026-10-30T09:00:00Z'),
      article('https://y.com/2', '2026-11-01T09:00:00Z', null),
    ])
    vi.mocked(getOraculForecast).mockResolvedValue({ forecast, logId: 'log-1' })
    vi.mocked(storeForecastEmbedding).mockResolvedValue()
  })

  it('searches strictly before T0 and asks Oracul as of T0 with the same articles, always with a body', async () => {
    const r = await simulateRetroEvent(input)

    expect(r).toMatchObject({ status: 'dry_run', claimText, asOf: '2026-11-03T00:00:00.000Z', probability: 0.6, articlesUsed: 2 })
    expect(searchNewsBefore).toHaveBeenCalledWith(expect.objectContaining({
      q: evidenceQuery(input.claimTemplate),
      before: new Date('2026-11-03T00:00:00Z'),
      after: new Date('2026-09-19T00:00:00Z'),
      indexedBefore: new Date('2026-11-10T00:00:00Z'),
      includeText: true,
    }))
    const [question, opts, meta] = vi.mocked(getOraculForecast).mock.calls[0]
    expect(question).toBe(claimText)
    expect(opts).toMatchObject({
      asOf: new Date('2026-11-03T00:00:00Z'),
      claimCreatedAt: new Date('2026-11-03T00:00:00Z'),
      claimDeadline: new Date('2026-11-30T23:59:59.999Z'),
      claimDirection: 'ARRIVAL',
    })
    expect(opts?.articles?.map((a) => a.text)).toEqual(['body', 'T https://y.com/2\n\nsnip'])
    expect(meta).toEqual({ source: 'retro-simulation' })
  })

  it('writes nothing on a dry run', async () => {
    await simulateRetroEvent(input)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(storeForecastEmbedding).not.toHaveBeenCalled()
  })

  it('drops an article dated at or after T0 even if the search returned it', async () => {
    vi.mocked(searchNewsBefore).mockResolvedValue([
      article('https://x.com/1', '2026-10-30T09:00:00Z'),
      article('https://late.com/2', '2026-11-03T00:00:00Z'),
    ])
    const r = await simulateRetroEvent(input)
    expect(r).toMatchObject({ status: 'skipped', reason: 'thin_evidence' })
    expect(getOraculForecast).not.toHaveBeenCalled()
  })

  it('skips an event a forecast already asks about', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'p1', claimText: 'same', status: 'ACTIVE', retro: false, score: 0.97 }])
    const r = await simulateRetroEvent(input)
    expect(r).toMatchObject({ status: 'skipped', reason: 'duplicate_forecast' })
    expect(searchNewsBefore).not.toHaveBeenCalled()
  })

  it('skips an event already behind a retro row with the same event URL', async () => {
    vi.mocked(prisma.retroSimulation.findFirst).mockResolvedValue({ predictionId: 'r1' } as never)
    expect(await simulateRetroEvent(input)).toMatchObject({ status: 'skipped', reason: 'duplicate_retro' })
  })

  it('skips when Oracul abstains or used fewer than two articles', async () => {
    vi.mocked(getOraculForecast).mockResolvedValueOnce({ forecast: null, logId: 'l', insufficientData: true, failureClass: 'oracle_abstain' })
    expect(await simulateRetroEvent(input)).toMatchObject({ status: 'skipped', reason: 'oracle_abstain' })
    vi.mocked(getOraculForecast).mockResolvedValueOnce({ forecast: { ...forecast, articles_used: 1 }, logId: 'l' })
    expect(await simulateRetroEvent(input)).toMatchObject({ status: 'skipped', reason: 'oracul_thin' })
  })

  it('recomputes the timeline itself: an event day after the reports is refused', async () => {
    const r = await simulateRetroEvent({ ...input, event: { ...input.event, date: '2026-11-15' } })
    expect(r).toEqual({ status: 'skipped', reason: 'event_after_reports' })
  })

  it('on apply, saves a private PENDING_APPROVAL draft with the Oracul answer frozen on its retro row', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'bot' } as never)
    vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
    tx.prediction.create.mockResolvedValue({ id: 'new' })

    const r = await simulateRetroEvent({ ...input, dryRun: false })

    expect(r).toMatchObject({ status: 'created', predictionId: 'new' })
    expect(tx.prediction.create.mock.calls[0][0].data).toMatchObject({
      authorId: 'bot',
      claimText,
      status: 'PENDING_APPROVAL',
      isPublic: false,
      outcomeType: 'BINARY',
      claimDirection: 'ARRIVAL',
      resolveByDatetime: new Date('2026-11-30T23:59:59.999Z'),
    })
    const retro = tx.retroSimulation.create.mock.calls[0][0].data
    expect(retro).toMatchObject({
      predictionId: 'new',
      asOf: new Date('2026-11-03T00:00:00Z'),
      cutoffAt: new Date('2026-11-10T00:00:00Z'),
      outcome: 'correct',
      eventUrl: 'https://b.com/2',
      oraculProbability: 0.6,
      articlesUsed: 2,
    })
    expect(retro.evidence.sent.map((a: { url: string }) => a.url)).toEqual(['https://x.com/1', 'https://y.com/2'])
    expect(retro.evidence.oracul.sources[0]).toMatchObject({ url: 'https://x.com/1', stance: 0.4 })
    expect(retro.evidence.reports).toHaveLength(2)
    expect(storeForecastEmbedding).toHaveBeenCalledWith('new', [0.1, 0.2])
  })
})

describe('evidenceQuery', () => {
  it.each([
    ["Israel's President will task Gadi Eisenkot with forming the next government by {DEADLINE}.", "Israel's President will task Gadi Eisenkot with forming the next government."],
    ['By {DEADLINE}, the Fed will cut rates.', 'the Fed will cut rates.'],
    ['Talks will resume before {DEADLINE} in Cairo.', 'Talks will resume in Cairo.'],
    ['Turnout will exceed 70% no later than {DEADLINE}', 'Turnout will exceed 70%'],
  ])('%s', (template, expected) => {
    expect(evidenceQuery(template)).toBe(expected)
  })

  it('handles a bare or unprefixed token', () => {
    expect(evidenceQuery('{DEADLINE}')).toBe('')
    expect(evidenceQuery('Rates fall {DEADLINE}')).toBe('Rates fall')
  })
})
