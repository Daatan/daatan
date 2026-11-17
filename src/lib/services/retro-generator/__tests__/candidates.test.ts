import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/lib/services/embedding', () => ({ embedTexts: vi.fn() }))
vi.mock('../judge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../judge')>()),
  judgeCluster: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { embedTexts } from '@/lib/services/embedding'
import { judgeCluster } from '../judge'
import { candidateReports, findRetroCandidates, loadPoolReports, mergeSameEvent, type JudgedCluster } from '../candidates'

const now = new Date('2026-11-17T12:00:00Z')
const row = (url: string, source: string, claim: string) => ({ url, source, published_date: '2026-11-10T10:00:00Z', claim, quote: null })
// Two outlets on one event, one outlet on another, and a repeat of the same article.
const poolRows = [
  row('https://a.com/1', 'a.com', 'Herzog tasked Eisenkot with forming the government, a precursor to X'),
  row('https://a.com/1', 'a.com', 'Herzog tasked Eisenkot with forming the government, which points to Y'),
  row('https://b.com/2', 'b.com', 'Herzog tasked Eisenkot with forming the government'),
  row('https://c.com/3', 'c.com', 'Bitcoin ETFs saw seven sessions of outflows'),
]
const vec = (text: string) => (text.startsWith('Herzog') ? [1, 0] : [0, 1])

function mockDb(knownUrls: string[] = []) {
  vi.mocked(prisma.$queryRaw)
    .mockResolvedValueOnce(poolRows)
    .mockResolvedValueOnce(knownUrls.map((url) => ({ url })))
}

describe('loadPoolReports', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps one report per (article, event), whatever forecast-relative tail each copy carries', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(poolRows)
    const { claims, reports } = await loadPoolReports(7)
    expect(claims).toBe(4)
    expect(reports.map((r) => r.url)).toEqual(['https://a.com/1', 'https://b.com/2', 'https://c.com/3'])
  })
})

describe('findRetroCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(embedTexts).mockImplementation(async (texts) => texts.map(vec))
    vi.mocked(judgeCluster).mockResolvedValue({ ok: false, reason: 'not_event:trend', kind: 'trend' })
  })

  it('judges only clusters reported by at least minSources outlets', async () => {
    mockDb()
    const r = await findRetroCandidates({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40, now })
    expect(r.clusters).toBe(2)
    expect(r.multiSource).toBe(1)
    expect(judgeCluster).toHaveBeenCalledOnce()
    expect(vi.mocked(judgeCluster).mock.calls[0][0].map((x) => x.url).sort()).toEqual(['https://a.com/1', 'https://b.com/2'])
    expect(r.skipped).toEqual([expect.objectContaining({ reason: 'not_event:trend', sources: 2 })])
  })

  it('drops a cluster whose articles a retro row already covers', async () => {
    mockDb(['https://a.com/1'])
    const r = await findRetroCandidates({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40, now })
    expect(r.known).toBe(1)
    expect(judgeCluster).not.toHaveBeenCalled()
  })

  it('returns a judged event with its preview timeline', async () => {
    mockDb()
    vi.mocked(judgeCluster).mockResolvedValue({
      ok: true,
      event: { kind: 'event', reason: 'r', summary: 's', date: '2026-11-10', url: 'https://b.com/2', claimTemplate: 'X by {DEADLINE}.', rulesTemplate: 'YES by {DEADLINE}.' },
      timeline: {
        eventDate: new Date('2026-11-10T00:00:00Z'),
        cutoffAt: new Date('2026-11-10T00:00:00Z'),
        asOf: new Date('2026-11-03T00:00:00Z'),
        evidenceAfter: new Date('2026-09-19T00:00:00Z'),
        deadline: new Date('2026-11-30T23:59:59.999Z'),
        earlyReports: 0,
      },
      claimText: 'X by November 30, 2026.',
      resolutionRules: 'YES by November 30, 2026.',
    })
    const r = await findRetroCandidates({ days: 7, threshold: 0.88, minSources: 2, maxClusters: 40, now })
    expect(r.candidates).toEqual([
      expect.objectContaining({
        sources: 2,
        claimTemplate: 'X by {DEADLINE}.',
        event: { summary: 's', date: '2026-11-10', url: 'https://b.com/2', reason: 'r' },
        preview: expect.objectContaining({ claimText: 'X by November 30, 2026.', asOf: '2026-11-03T00:00:00.000Z' }),
        merged: [],
      }),
    ])
  })
})

const report = (url: string, source: string, publishedDate: string) => ({ url, source, publishedDate, claim: `c ${url}`, quote: null })
function judgedCluster(claimText: string, sources: number, reports: ReturnType<typeof report>[], date = '2026-11-08'): JudgedCluster {
  return {
    sources,
    reports,
    judged: {
      ok: true,
      event: { kind: 'event', reason: 'r', summary: claimText, date, url: reports[reports.length - 1].url, claimTemplate: `${claimText} by {DEADLINE}.`, rulesTemplate: 'YES by {DEADLINE}.' },
      // Not read by the merge: it recomputes the timeline over the pooled reports.
      timeline: {} as JudgedCluster['judged']['timeline'],
      claimText: `${claimText} by November 30, 2026.`,
      resolutionRules: 'YES by November 30, 2026.',
    },
  }
}

describe('mergeSameEvent', () => {
  it('folds the same event judged out of several clusters into one candidate with pooled reports and one T0', () => {
    const items = [
      judgedCluster('Herzog will task Eisenkot', 3, [report('https://aa.com/live', 'aa.com', '2026-11-01T09:00:00Z'), report('https://a.com/1', 'a.com', '2026-11-08T12:00:00Z'), report('https://b.com/1', 'b.com', '2026-11-09T07:00:00Z')]),
      judgedCluster('Bitcoin ETFs will see outflows', 2, [report('https://c.com/1', 'c.com', '2026-11-10T10:00:00Z'), report('https://d.com/1', 'd.com', '2026-11-11T10:00:00Z')], '2026-11-10'),
      judgedCluster('Israel\'s President will task Eisenkot', 2, [report('https://e.com/1', 'e.com', '2026-11-08T15:00:00Z'), report('https://b.com/1', 'b.com', '2026-11-09T07:00:00Z')]),
    ]
    const out = mergeSameEvent(items, [[1, 0], [0, 1], [0.99, 0.05]], now)

    expect(out.map((c) => c.preview.claimText)).toEqual(['Herzog will task Eisenkot by November 30, 2026.', 'Bitcoin ETFs will see outflows by November 30, 2026.'])
    const [herzog] = out
    expect(herzog.merged).toEqual([{ claimText: "Israel's President will task Eisenkot by November 30, 2026.", sources: 2 }])
    expect(herzog.sources).toBe(4)
    expect(herzog.reports.map((r) => r.url)).toEqual(['https://a.com/1', 'https://e.com/1', 'https://b.com/1', 'https://aa.com/live'])
    // The live page dated a week early neither drags T0 back nor is lost.
    expect(herzog.preview).toMatchObject({ asOf: '2026-11-01T00:00:00.000Z', cutoffAt: '2026-11-08T00:00:00.000Z', earlyReports: 1 })
  })

  it('keeps a claim it could not embed as its own candidate', () => {
    const items = [
      judgedCluster('A', 2, [report('https://a.com/1', 'a.com', '2026-11-08T12:00:00Z')]),
      judgedCluster('A again', 2, [report('https://b.com/1', 'b.com', '2026-11-08T12:00:00Z')]),
    ]
    expect(mergeSameEvent(items, [[1, 0], null], now)).toHaveLength(2)
  })
})

describe('candidateReports', () => {
  it('spends the slots on reports of the event, and always keeps the one the judge named', () => {
    const early = Array.from({ length: 5 }, (_, i) => report(`https://early.com/${i}`, 'early.com', `2026-10-2${i}T00:00:00Z`))
    const onEvent = Array.from({ length: 25 }, (_, i) => report(`https://on.com/${i}`, 'on.com', `2026-11-${String(8 + Math.floor(i / 5)).padStart(2, '0')}T0${i % 5}:00:00Z`))
    const out = candidateReports([...early, ...onEvent], '2026-11-08', 'https://early.com/2')
    expect(out).toHaveLength(20)
    expect(out.slice(0, 19).every((r) => r.url.startsWith('https://on.com/'))).toBe(true)
    expect(out[19].url).toBe('https://early.com/2')
  })
})
