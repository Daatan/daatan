/**
 * @jest-environment node
 */
import { describe, it, expect } from 'vitest'
import type { OracleSource } from '@/lib/services/oracle'
import type { SearchResult } from '@/lib/services/oracleSearch'
import type { EvidencePoolArticle } from '@prisma/client'
import {
  enrichOracleSources,
  oracleSnapshotToContributingSources,
  poolArticleToEnrichedSource,
} from '../oracle-snapshot'

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
  evidence_weight: 0.6,
  relevance_score: 0.85,
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
      evidenceWeight: 0.6,
      relevanceScore: 0.85,
    })
  })

  it('leaves title/date/author null when not joinable', () => {
    const out = enrichOracleSources([oracleSource({ url: 'https://x.com/y' })], [], new Map())
    expect(out[0]).toMatchObject({ title: null, publishedAt: null, author: null })
  })

  it('joins resolved person/outlet identity from the identityByUrl map', () => {
    const out = enrichOracleSources(
      [oracleSource()],
      [searchResult()],
      new Map(),
      new Map([['https://reuters.com/a', {
        personId: 'p-1', personName: 'Jane Doe', outletId: 'o-1', outletName: 'Reuters',
      }]]),
    )
    expect(out[0]).toMatchObject({
      personId: 'p-1', personName: 'Jane Doe', outletId: 'o-1', outletName: 'Reuters',
    })
  })

  it('defaults person/outlet identity to null when identityByUrl is omitted', () => {
    const out = enrichOracleSources([oracleSource()], [searchResult()], new Map())
    expect(out[0]).toMatchObject({ personId: null, personName: null, outletId: null, outletName: null })
  })

  it('defaults settled/quantitativeEstimate/evidenceWeight/relevanceScore to null when the Oracle omits them', () => {
    const out = enrichOracleSources(
      [oracleSource({
        settled: undefined,
        quantitative_estimate: undefined,
        evidence_weight: undefined,
        relevance_score: undefined,
      })],
      [searchResult()],
      new Map(),
    )
    expect(out[0]).toMatchObject({
      settled: null,
      quantitativeEstimate: null,
      evidenceWeight: null,
      relevanceScore: null,
    })
  })
})

const poolArticle = (over: Partial<EvidencePoolArticle> = {}): EvidencePoolArticle =>
  ({
    id: 'row-1',
    predictionId: 'pred-1',
    url: 'https://reuters.com/a',
    urlHash: 'hash-1',
    title: 'Headline',
    source: 'reuters.com',
    publishedDate: '2026-07-01',
    contentHash: null,
    status: 'COMPLETE',
    statusReason: null,
    stance: 0.5,
    certainty: 0.8,
    credibilityWeight: 1.0,
    claims: ['it will happen', 'second claim'],
    settled: true,
    quantitativeEstimate: 0.62,
    evidenceWeight: 0.6,
    relevanceScore: 0.9,
    evidenceClass: 'reported_fact',
    origin: 'news-indexer',
    excluded: false,
    personId: null,
    personName: null,
    outletId: 'o-1',
    outletName: 'Reuters',
    addedAt: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-01'),
    ...over,
  }) as EvidencePoolArticle

describe('poolArticleToEnrichedSource', () => {
  it('maps a pool row to the snapshot source shape, taking author from the caller', () => {
    const out = poolArticleToEnrichedSource(poolArticle(), 'Jane Doe')
    expect(out).toEqual({
      sourceId: 'row-1', // the pool row id is the stable display key
      sourceName: 'reuters.com',
      url: 'https://reuters.com/a',
      stance: 0.5,
      certainty: 0.8,
      credibilityWeight: 1.0,
      claims: ['it will happen', 'second claim'],
      title: 'Headline',
      publishedAt: '2026-07-01',
      author: 'Jane Doe',
      personId: null,
      personName: null,
      outletId: 'o-1',
      outletName: 'Reuters',
      settled: true,
      quantitativeEstimate: 0.62,
      evidenceWeight: 0.6,
      relevanceScore: 0.9,
      evidenceClass: 'reported_fact',
    })
  })

  it('carries a null author through (pool rows never store one)', () => {
    expect(poolArticleToEnrichedSource(poolArticle(), null).author).toBeNull()
  })

  it('coerces a non-array / dirty claims Json to a clean string[]', () => {
    expect(poolArticleToEnrichedSource(poolArticle({ claims: null as never }), null).claims).toEqual([])
    expect(
      poolArticleToEnrichedSource(poolArticle({ claims: ['ok', 42, null, 'also'] as never }), null).claims,
    ).toEqual(['ok', 'also'])
  })

  it('nulls an unrecognised evidenceClass rather than passing the raw string through', () => {
    expect(poolArticleToEnrichedSource(poolArticle({ evidenceClass: 'garbage' }), null).evidenceClass).toBeNull()
    expect(poolArticleToEnrichedSource(poolArticle({ evidenceClass: 'opinion' }), null).evidenceClass).toBe('opinion')
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
