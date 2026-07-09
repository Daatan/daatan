/**
 * @jest-environment node
 */
import { describe, it, expect } from 'vitest'
import type { OracleSource } from '@/lib/services/oracle'
import type { SearchResult } from '@/lib/services/oracleSearch'
import { enrichOracleSources, oracleSnapshotToContributingSources } from '../oracle-snapshot'

const oracleSource = (over: Partial<OracleSource> = {}): OracleSource => ({
  source_id: 's1',
  source_name: 'Reuters',
  url: 'https://reuters.com/a',
  stance: 0.5,
  certainty: 0.8,
  credibility_weight: 1,
  claims: ['it will happen'],
  settled: true,
  quantitative_estimate: 0.62,
  ...over,
})

const searchResult = (over: Partial<SearchResult> = {}): SearchResult => ({
  title: 'Headline',
  url: 'https://reuters.com/a',
  snippet: 'snip',
  source: 'Reuters',
  publishedDate: '2026-06-18',
  ...over,
})

describe('enrichOracleSources', () => {
  it('joins title + date from the input articles and author from the lookup', () => {
    const out = enrichOracleSources(
      [oracleSource()],
      [searchResult()],
      new Map([['https://reuters.com/a', 'Jane Doe']]),
    )
    expect(out[0]).toMatchObject({
      url: 'https://reuters.com/a',
      sourceName: 'Reuters',
      stance: 0.5,
      certainty: 0.8,
      title: 'Headline',
      publishedAt: '2026-06-18',
      author: 'Jane Doe',
      settled: true,
      quantitativeEstimate: 0.62,
    })
  })

  it('leaves title/date/author null when not joinable', () => {
    const out = enrichOracleSources([oracleSource({ url: 'https://x.com/y' })], [], new Map())
    expect(out[0]).toMatchObject({ title: null, publishedAt: null, author: null })
  })

  it('defaults settled/quantitativeEstimate to null when the Oracle omits them', () => {
    const out = enrichOracleSources(
      [oracleSource({ settled: undefined, quantitative_estimate: undefined })],
      [searchResult()],
      new Map(),
    )
    expect(out[0]).toMatchObject({ settled: null, quantitativeEstimate: null })
  })
})

describe('oracleSnapshotToContributingSources', () => {
  it('maps a well-formed snapshot to oracle-origin contributing sources', () => {
    const snap = {
      sources: [
        { url: 'https://bbc.com/x', sourceName: 'BBC', stance: -0.4, certainty: 0.6, author: 'Tom', title: 'T', publishedAt: '2026-06-17', claims: ['c1', 'c2'] },
      ],
    }
    const out = oracleSnapshotToContributingSources(snap)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      url: 'https://bbc.com/x',
      source: 'BBC',
      stance: -0.4,
      certainty: 0.6,
      author: 'Tom',
      claim: 'c1',
      origin: 'oracle',
    })
  })

  it('is defensive: null/non-object/non-array → []', () => {
    expect(oracleSnapshotToContributingSources(null)).toEqual([])
    expect(oracleSnapshotToContributingSources('nope')).toEqual([])
    expect(oracleSnapshotToContributingSources({ sources: 'no' })).toEqual([])
    expect(oracleSnapshotToContributingSources({})).toEqual([])
  })

  it('skips malformed entries (missing url, bad types) but keeps good ones', () => {
    const out = oracleSnapshotToContributingSources({
      sources: [
        { sourceName: 'no url' },
        null,
        42,
        { url: 'https://ok.com/a', stance: 'bad', certainty: 0.5 },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://ok.com/a')
    expect(out[0].stance).toBeNull() // 'bad' coerced to null
    expect(out[0].certainty).toBe(0.5)
  })
})
