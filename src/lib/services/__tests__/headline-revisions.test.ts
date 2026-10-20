import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'crypto'

const { prediction, revision } = vi.hoisted(() => ({
  prediction: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  revision: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: { prediction, predictionHeadlineRevision: revision } }))
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))

import {
  applyHeadlineRevisions, withDisplayHeadlines, displayHeadlineFor, type HeadlineRevisionEntry,
} from '../headline-revisions'
import { HEADLINE_REVISIONS, HEADLINE_REVISION_BATCH } from '../headline-revisions.data'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const CLAIM = 'Benny Gantz will withdraw from the race for the general elections in Israel before October 27, 2026.'
const entry: HeadlineRevisionEntry = {
  id: 'p1', slug: 'gantz', from: 'Gantz will withdraw', to: 'Benny Gantz will withdraw from the race before the elections', reason: 'V',
}
const published = { status: 'ACTIVE', claimText: CLAIM, headline: 'Gantz will withdraw' }

describe('applyHeadlineRevisions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prediction.findUnique.mockResolvedValue(published)
    revision.findUnique.mockResolvedValue(null)
  })

  it('is a dry run by default: reports would_apply and writes nothing', async () => {
    const report = await applyHeadlineRevisions([entry], 'b1')
    expect(report.dryRun).toBe(true)
    expect(report.counts.would_apply).toBe(1)
    expect(revision.create).not.toHaveBeenCalled()
  })

  it('inserts a revision with the audit trail and never writes to predictions', async () => {
    const report = await applyHeadlineRevisions([entry], 'b1', { apply: true })
    expect(report.counts.applied).toBe(1)
    expect(revision.create).toHaveBeenCalledWith({
      data: {
        predictionId: 'p1', headline: entry.to, previousHeadline: 'Gantz will withdraw',
        claimHash: hash(CLAIM), reason: 'V', batch: 'b1',
      },
    })
    expect(prediction.update).not.toHaveBeenCalled()
    expect(prediction.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null, 'missing'],
    ['resolved', { ...published, status: 'RESOLVED_CORRECT' }, 'not_active'],
    ['inactive', { ...published, status: 'PENDING' }, 'not_active'],
    ['drifted', { ...published, headline: 'Something else' }, 'drifted'],
    ['no headline', { ...published, headline: null }, 'drifted'],
  ])('skips a %s forecast', async (_n, row, outcome) => {
    prediction.findUnique.mockResolvedValue(row)
    const report = await applyHeadlineRevisions([entry], 'b1', { apply: true })
    expect(report.rows[0].outcome).toBe(outcome)
    expect(revision.create).not.toHaveBeenCalled()
  })

  it('rejects a proposal over the length guards or that flips the claim negation', async () => {
    const long = { ...entry, to: 'x'.repeat(61) }
    const words = { ...entry, to: 'a b c d e f g h i j k l m' }
    prediction.findUnique.mockResolvedValue({ ...published, claimText: 'Putin will not die by 2026' })
    const flipped = { ...entry, to: 'Putin will die by 2026' }
    const report = await applyHeadlineRevisions([long, words, flipped], 'b1', { apply: true })
    expect(report.rows.map((r) => r.outcome)).toEqual(['invalid', 'invalid', 'invalid'])
    expect(revision.create).not.toHaveBeenCalled()
  })

  it('is idempotent: an existing revision for the batch is reported as already', async () => {
    revision.findUnique.mockResolvedValue({ id: 'r1' })
    const report = await applyHeadlineRevisions([entry], 'b1', { apply: true })
    expect(report.counts.already).toBe(1)
    expect(revision.create).not.toHaveBeenCalled()
  })
})

describe('display headline overlay', () => {
  beforeEach(() => vi.resetAllMocks())
  const row = { id: 'p1', claimText: CLAIM, headline: 'Gantz will withdraw', other: 1 }

  it('swaps the headline when a non-revoked revision matches the claim', async () => {
    revision.findMany.mockResolvedValue([{ predictionId: 'p1', headline: entry.to, claimHash: hash(CLAIM) }])
    const [out] = await withDisplayHeadlines([row])
    expect(out.headline).toBe(entry.to)
    expect(out.other).toBe(1)
    expect(revision.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { predictionId: { in: ['p1'] }, revokedAt: null } }))
  })

  it('uses the newest revision when there are several', async () => {
    revision.findMany.mockResolvedValue([
      { predictionId: 'p1', headline: 'newer', claimHash: hash(CLAIM) },
      { predictionId: 'p1', headline: 'older', claimHash: hash(CLAIM) },
    ])
    expect((await withDisplayHeadlines([row]))[0].headline).toBe('newer')
  })

  it('ignores a revision once the claim has been edited', async () => {
    revision.findMany.mockResolvedValue([{ predictionId: 'p1', headline: entry.to, claimHash: hash('old claim') }])
    expect((await withDisplayHeadlines([row]))[0].headline).toBe('Gantz will withdraw')
    expect(await displayHeadlineFor('p1', CLAIM)).toBeNull()
  })

  it('leaves rows without a revision untouched', async () => {
    revision.findMany.mockResolvedValue([])
    const rows = [row]
    expect(await withDisplayHeadlines(rows)).toBe(rows)
  })

  it('keeps the published headlines if the lookup fails', async () => {
    revision.findMany.mockRejectedValue(new Error('db down'))
    expect((await withDisplayHeadlines([row]))[0].headline).toBe('Gantz will withdraw')
  })
})

describe('reviewed batch data', () => {
  it('has unique ids and every proposal passes the headline guards', () => {
    expect(HEADLINE_REVISION_BATCH).toBe('2026-10-active')
    expect(HEADLINE_REVISIONS).toHaveLength(53)
    expect(new Set(HEADLINE_REVISIONS.map((e) => e.id)).size).toBe(53)
    for (const e of HEADLINE_REVISIONS) {
      expect(e.to.length).toBeLessThanOrEqual(60)
      expect(e.to.split(' ').length).toBeLessThanOrEqual(12)
      expect(e.to).not.toBe(e.from)
      expect(e.to).not.toMatch(/[.。]$/)
      expect(['V', 'P', 'G', 'S', 'T']).toContain(e.reason)
    }
  })
})
