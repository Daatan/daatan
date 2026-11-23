import { describe, it, expect } from 'vitest'
import { groupPublications } from '../group-publications'
import type { PublicOutletPublication } from '@/lib/services/outlets'

const row = (over: Partial<PublicOutletPublication>): PublicOutletPublication => ({
  title: 'Zelenskyy on four-party talks',
  url: 'https://example.com/a',
  source: 'example.com',
  publishedAt: '2026-11-20T10:00:00Z',
  pushedAt: '2026-11-20T11:00:00Z',
  forecastId: 'f1',
  outcome: null,
  ...over,
})

describe('groupPublications (#2292)', () => {
  it('collapses one article that fed two forecasts into one entry with both forecasts', () => {
    const out = groupPublications([row({ forecastId: 'f1' }), row({ forecastId: 'f2', outcome: 'correct' })])
    expect(out).toHaveLength(1)
    expect(out[0].forecasts).toEqual([
      { forecastId: 'f1', outcome: null },
      { forecastId: 'f2', outcome: 'correct' },
    ])
  })

  it('keeps the API order (newest first) across articles', () => {
    const out = groupPublications([
      row({ url: 'https://example.com/new', title: 'New' }),
      row({ url: 'https://example.com/old', title: 'Old' }),
      row({ url: 'https://example.com/new', title: 'New', forecastId: 'f9' }),
    ])
    expect(out.map((p) => p.title)).toEqual(['New', 'Old'])
    expect(out[0].forecasts.map((f) => f.forecastId)).toEqual(['f1', 'f9'])
  })

  it('lists a forecast once even when the same match was pushed twice', () => {
    const out = groupPublications([row({}), row({})])
    expect(out[0].forecasts).toHaveLength(1)
  })

  it('keeps an article with no forecast and no url as its own entry', () => {
    const out = groupPublications([
      row({ url: null, title: null, forecastId: null }),
      row({ url: null, title: null, forecastId: null }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].forecasts).toEqual([])
  })

  it('fills a missing title or date from a later row of the same article', () => {
    const out = groupPublications([row({ title: null, publishedAt: null }), row({ forecastId: 'f2' })])
    expect(out[0].title).toBe('Zelenskyy on four-party talks')
    expect(out[0].publishedAt).toBe('2026-11-20T10:00:00Z')
  })
})
