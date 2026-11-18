import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import { llmService } from '@/lib/llm'
import { judgeCluster, judgeReports, validateJudgement } from '../judge'
import type { PoolReport } from '../types'

const now = new Date('2026-11-17T12:00:00Z')
const report = (url: string, publishedDate: string, claim = 'Herzog tasked Eisenkot with forming the government'): PoolReport =>
  ({ url, source: new URL(url).hostname, publishedDate, claim, quote: null })
const reports = [report('https://a.com/1', '2026-11-10T15:00:00Z'), report('https://b.com/2', '2026-11-11T08:00:00Z')]

const answer = {
  kind: 'event',
  reason: 'One appointment on one day.',
  eventSummary: 'President Herzog tasked Gadi Eisenkot with forming the next government.',
  eventDate: '2026-11-10',
  eventIndex: 2,
  claim: "Israel's President will task Gadi Eisenkot with forming the next government by {DEADLINE}.",
  resolutionRules: 'YES if the President tasks Eisenkot by {DEADLINE}, per official sources. NO otherwise.',
}

describe('validateJudgement', () => {
  it('fills the deadline and takes the event URL from the report the judge pointed at', () => {
    const r = validateJudgement(answer, reports, now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.claimText).toBe("Israel's President will task Gadi Eisenkot with forming the next government by November 30, 2026.")
    expect(r.resolutionRules).toContain('by November 30, 2026')
    expect(r.event.url).toBe('https://b.com/2')
    expect(r.timeline.asOf.toISOString()).toBe('2026-11-03T00:00:00.000Z')
  })

  it('skips anything that is not one dated past event', () => {
    expect(validateJudgement({ ...answer, kind: 'trend' }, reports, now)).toMatchObject({ ok: false, reason: 'not_event:trend' })
    expect(validateJudgement({ ...answer, kind: 'routine' }, reports, now)).toMatchObject({ ok: false, reason: 'not_event:routine', kind: 'routine' })
    expect(validateJudgement({ ...answer, kind: 'whatever' }, reports, now)).toMatchObject({ ok: false, reason: 'judge_bad_kind' })
    expect(validateJudgement({ ...answer, eventIndex: 3 }, reports, now)).toMatchObject({ ok: false, reason: 'judge_bad_index' })
    expect(validateJudgement({ ...answer, claim: 'X will happen soon.' }, reports, now)).toMatchObject({ ok: false, reason: 'judge_no_deadline_token' })
    expect(validateJudgement({ ...answer, eventDate: '' }, reports, now)).toMatchObject({ ok: false, reason: 'undated' })
    expect(validateJudgement({ ...answer, eventSummary: '' }, reports, now)).toMatchObject({ ok: false, reason: 'judge_incomplete' })
  })
})

describe('judgeReports', () => {
  it('keeps one report per article, earliest first', () => {
    const out = judgeReports([reports[1], reports[0], report('https://a.com/1', '2026-11-10T15:00:00Z', 'another claim')])
    expect(out.map((r) => r.url)).toEqual(['https://a.com/1', 'https://b.com/2'])
  })
})

describe('judgeCluster', () => {
  beforeEach(() => vi.clearAllMocks())

  it('numbers the reports with date and outlet and runs on its own stage at temperature 0', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: JSON.stringify(answer) })
    const r = await judgeCluster(reports, now)
    expect(r.ok).toBe(true)
    const req = vi.mocked(llmService.generateContent).mock.calls[0][0]
    expect(req).toMatchObject({ stage: 'retro_event_judge', temperature: 0 })
    expect(req.prompt).toContain('[1] 2026-11-10 · a.com — Herzog tasked Eisenkot')
    expect(req.prompt).toContain('Today is 2026-11-17.')
  })

  it('fails closed: a model error skips the cluster', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValue(new Error('quota'))
    expect(await judgeCluster(reports, now)).toEqual({ ok: false, reason: 'judge_error' })
  })
})
