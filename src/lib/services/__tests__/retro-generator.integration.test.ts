import { describe, expect, it, vi, beforeEach } from 'vitest'

const VECTOR = Array.from({ length: 768 }, (_, i) => ((i % 11) + 1) / 11)

vi.mock('@/lib/services/embedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/embedding')>()),
  embedText: vi.fn(async () => VECTOR),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => VECTOR)),
}))
vi.mock('@/lib/services/retro-generator/judge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/retro-generator/judge')>()),
  judgeCluster: vi.fn(async () => ({ ok: false, reason: 'not_event:trend', kind: 'trend' })),
}))
vi.mock('@/lib/services/news-indexer', () => ({ searchNewsBefore: vi.fn(async () => []) }))
vi.mock('@/lib/services/oracle', () => ({ getOraculForecast: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { judgeCluster } from '@/lib/services/retro-generator/judge'
import { searchNewsBefore } from '@/lib/services/news-indexer'
import { getOraculForecast, type OracleForecastResponse } from '@/lib/services/oracle'
import { findRetroCandidates } from '@/lib/services/retro-generator/candidates'
import { simulateRetroEvent, type SimulateInput } from '@/lib/services/retro-generator/simulate'

let seq = 0
const unique = () => `${Date.now()}-${++seq}`
const now = new Date()
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000)

async function makePrediction(data: Record<string, unknown> = {}) {
  const author = await prisma.user.create({ data: { email: `u-${unique()}@example.com`, name: 'U' } })
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${unique()}`,
      authorId: author.id,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: day(30),
      shareToken: `token-${unique()}`,
      ...data,
    } as never,
  })
}

const claim = (text: string, over: Record<string, string> = {}) => ({
  claim: text, quote: 'q', evidence_class: 'reported_fact', is_occurrence: 'false', report_kind: 'change', verified: 'true', is_conditional: 'false', ...over,
})

async function poolRow(predictionId: string, url: string, claimsDetail: unknown, extra: Record<string, unknown> = {}) {
  await prisma.evidencePoolArticle.create({
    data: { predictionId, url, urlHash: `h-${unique()}`, origin: 'news_indexer', source: new URL(url).hostname, publishedDate: day(-2).toISOString(), claimsDetail, ...extra } as never,
  })
}

describe('retro generator SQL against Postgres (daatan#2217)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads only current, recent, reported-fact non-occurrence claims, and drops clusters a retro row covers', async () => {
    const p = await makePrediction()
    await poolRow(p.id, 'https://a.com/1', [
      claim('Herzog tasked Eisenkot with forming the government'),
      claim('Eisenkot became prime minister', { is_occurrence: 'true' }),
      claim('Analysts expect a coalition', { evidence_class: 'opinion' }),
      claim('Herzog may task Eisenkot', { is_conditional: 'true' }),
      claim(''),
    ])
    await poolRow(p.id, 'https://b.com/2', [claim('Herzog tasked Eisenkot with forming the government')])
    await poolRow(p.id, 'https://c.com/3', [claim('Herzog tasked Eisenkot')], { supersededAt: day(-1) })
    await poolRow(p.id, 'https://d.com/4', [claim('Herzog tasked Eisenkot')], { addedAt: day(-30) })
    await poolRow(p.id, 'https://e.com/5', { claim: 'not an array' })

    const first = await findRetroCandidates({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 })
    expect(first).toMatchObject({ claims: 2, reports: 2, clusters: 1, multiSource: 1, known: 0, judged: 1 })
    expect(vi.mocked(judgeCluster).mock.calls[0][0].map((r) => r.url).sort()).toEqual(['https://a.com/1', 'https://b.com/2'])

    // Hand-made PR 1 rows have no evidence, or evidence of another shape: neither breaks the read.
    const retro = await makePrediction({ status: 'PENDING_APPROVAL' })
    await prisma.retroSimulation.create({
      data: { predictionId: retro.id, asOf: day(-9), cutoffAt: day(-2), outcome: 'correct', evidence: { reports: [{ url: 'https://a.com/1' }, { url: 'https://b.com/2' }] } },
    })
    const bare = await makePrediction({ status: 'PENDING_APPROVAL' })
    await prisma.retroSimulation.create({ data: { predictionId: bare.id, asOf: day(-9), cutoffAt: day(-2), outcome: 'correct' } })
    const odd = await makePrediction({ status: 'PENDING_APPROVAL' })
    await prisma.retroSimulation.create({ data: { predictionId: odd.id, asOf: day(-9), cutoffAt: day(-2), outcome: 'correct', evidence: { reports: 'x' } } })

    vi.mocked(judgeCluster).mockClear()
    const second = await findRetroCandidates({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 })
    expect(second).toMatchObject({ multiSource: 1, known: 1, judged: 0 })
    expect(judgeCluster).not.toHaveBeenCalled()
  })

  describe('simulateRetroEvent', () => {
    const eventDay = day(-8).toISOString().slice(0, 10)
    const input: SimulateInput = {
      reports: [
        { url: 'https://a.com/1', source: 'a.com', publishedDate: day(-8).toISOString(), claim: 'Herzog tasked Eisenkot', quote: null },
        { url: 'https://b.com/2', source: 'b.com', publishedDate: day(-7).toISOString(), claim: 'Eisenkot got the mandate', quote: null },
      ],
      event: { summary: 'Herzog tasked Eisenkot.', date: eventDay, url: 'https://b.com/2', reason: 'one act' },
      claimTemplate: "Israel's President will task Gadi Eisenkot with forming the next government by {DEADLINE}.",
      rulesTemplate: 'YES if he is tasked by {DEADLINE}. NO otherwise.',
      dryRun: false,
    }
    const article = (url: string, offsetDays: number) => ({
      title: `T ${url}`, url, snippet: 'snip', source: 'x.com', language: 'en', published_date: day(offsetDays).toISOString().slice(0, 10),
      published_at: day(offsetDays).toISOString(), published_at_source: 'meta', indexed_at: day(offsetDays).toISOString(), similarity: 0.7, text: 'body',
    })

    it('skips an event a forecast with the same claim vector already asks', async () => {
      const p = await makePrediction()
      await prisma.$executeRawUnsafe(`UPDATE predictions SET embedding = '[${VECTOR.join(',')}]'::vector WHERE id = $1`, p.id)
      const r = await simulateRetroEvent(input)
      expect(r).toMatchObject({ status: 'skipped', reason: 'duplicate_forecast', detail: { id: p.id, retro: false } })
      expect(searchNewsBefore).not.toHaveBeenCalled()
    })

    it('saves the draft, its frozen evidence and its vector on apply, then refuses the same event again', async () => {
      await makePrediction() // a forecast with no vector is not a duplicate
      vi.mocked(searchNewsBefore).mockResolvedValue([article('https://x.com/1', -20), article('https://y.com/2', -18), article('https://z.com/3', -16)])
      vi.mocked(getOraculForecast).mockResolvedValue({
        logId: 'log-1',
        forecast: {
          mean: 0.2, articles_used: 3, std: 0.1, ci_low: 0, ci_high: 0.4, placeholder: false, question: 'q',
          sources: [{ source_id: 's', source_name: 'x.com', url: 'https://x.com/1', stance: 0.4, certainty: 0.8, credibility_weight: 1, claims: ['c'] }],
        } as OracleForecastResponse,
      })

      const r = await simulateRetroEvent(input)
      expect(r).toMatchObject({ status: 'created', probability: 0.6, articlesUsed: 3 })
      const id = (r as { predictionId: string }).predictionId

      const saved = await prisma.prediction.findUniqueOrThrow({ where: { id }, include: { author: true, retroSimulation: true } })
      expect(saved).toMatchObject({ status: 'PENDING_APPROVAL', isPublic: false, source: 'retro_simulation', author: { email: 'retro_sim@daatan.internal', isBot: true } })
      expect(saved.retroSimulation).toMatchObject({ eventUrl: 'https://b.com/2', oraculProbability: 0.6, articlesUsed: 3, outcome: 'correct' })
      const evidence = saved.retroSimulation?.evidence as { sent: Array<{ url: string }>; reports: unknown[] }
      expect(evidence.sent.map((a) => a.url)).toEqual(['https://x.com/1', 'https://y.com/2', 'https://z.com/3'])
      expect(evidence.reports).toHaveLength(2)
      const [{ has }] = await prisma.$queryRawUnsafe<Array<{ has: boolean }>>(`SELECT embedding IS NOT NULL AS has FROM predictions WHERE id = $1`, id)
      expect(has).toBe(true)

      expect(await simulateRetroEvent(input)).toMatchObject({ status: 'skipped', reason: 'duplicate_retro' })
      const other = await simulateRetroEvent({ ...input, event: { ...input.event, url: 'https://a.com/1' } })
      expect(other).toMatchObject({ status: 'skipped', reason: 'duplicate_retro', detail: { id } })
    })
  })
})
