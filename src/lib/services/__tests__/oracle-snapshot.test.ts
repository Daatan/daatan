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
  stanceToPercent,
  PUBLISH_PERCENT_MIN,
  PUBLISH_PERCENT_MAX,
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
  settlement_event_date: '2026-06-15',
  quantitative_estimate: 0.62,
  evidence_weight: 0.6,
  relevance_score: 0.85,
  author_lean: -0.4,
  author_lean_certainty: 0.7,
  fact_signal: 0.3,
  event_actors: 'Israel',
  event_target: 'Iran',
  is_occurrence: false,
  verified: true,
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
  it('carries the Oracle\'s per-claim layer through untouched (F1, retro#364)', () => {
    const claims_detail = [
      { claim: 'A.', quote: 'Verbatim.', stance: 0.6, certainty: 0.8, evidence_class: 'reported_fact' as const },
    ]
    const out = enrichOracleSources([oracleSource({ claims_detail })], [searchResult()], new Map())
    expect(out[0].claimsDetail).toEqual(claims_detail)
  })

  it('defaults claimsDetail to null when the Oracle omitted it (older build)', () => {
    const out = enrichOracleSources([oracleSource()], [searchResult()], new Map())
    expect(out[0].claimsDetail).toBeNull()
  })

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
      settlementEventDate: '2026-06-15',
      quantitativeEstimate: 0.62,
      evidenceWeight: 0.6,
      relevanceScore: 0.85,
      authorLean: -0.4,
      authorLeanCertainty: 0.7,
      factSignal: 0.3,
      eventActors: 'Israel',
      eventTarget: 'Iran',
      isOccurrence: false,
      verified: true,
      carriedForward: false,
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

  it('defaults settled/quantitativeEstimate/evidenceWeight/relevanceScore/authorLean/factSignal to null when the Oracle omits them', () => {
    const out = enrichOracleSources(
      [oracleSource({
        settled: undefined,
        settlement_event_date: undefined,
        quantitative_estimate: undefined,
        evidence_weight: undefined,
        relevance_score: undefined,
        author_lean: undefined,
        author_lean_certainty: undefined,
        fact_signal: undefined,
        event_actors: undefined,
        event_target: undefined,
        is_occurrence: undefined,
        verified: undefined,
      })],
      [searchResult()],
      new Map(),
    )
    expect(out[0]).toMatchObject({
      settled: null,
      settlementEventDate: null,
      quantitativeEstimate: null,
      evidenceWeight: null,
      relevanceScore: null,
      authorLean: null,
      authorLeanCertainty: null,
      factSignal: null,
      eventActors: null,
      eventTarget: null,
      isOccurrence: null,
      verified: null,
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
    settlementEventDate: '2026-06-15',
    quantitativeEstimate: 0.62,
    evidenceWeight: 0.6,
    relevanceScore: 0.9,
    evidenceClass: 'reported_fact',
    authorLean: -0.4,
    authorLeanCertainty: 0.7,
    factSignal: 0.3,
    eventActors: 'Israel',
    eventTarget: 'Iran',
    isOccurrence: false,
    verified: true,
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
      settlementEventDate: '2026-06-15',
      quantitativeEstimate: 0.62,
      evidenceWeight: 0.6,
      relevanceScore: 0.9,
      evidenceClass: 'reported_fact',
      authorLean: -0.4,
      authorLeanCertainty: 0.7,
      factSignal: 0.3,
      eventActors: 'Israel',
      eventTarget: 'Iran',
      isOccurrence: false,
      verified: true,
      claimsDetail: null,
      carriedForward: false,
    })
  })

  it('carries a null author through (pool rows never store one)', () => {
    expect(poolArticleToEnrichedSource(poolArticle(), null).author).toBeNull()
  })

  it('defaults carriedForward to false, and passes through an explicit value', () => {
    expect(poolArticleToEnrichedSource(poolArticle(), null).carriedForward).toBe(false)
    expect(poolArticleToEnrichedSource(poolArticle(), null, true).carriedForward).toBe(true)
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

  // F1/F15 (daatan#1235, retro#364) — claims_detail is an untyped Json column written
  // by an external service, so it gets the same defensive narrowing as `claims`.
  it('reads back a well-formed claimsDetail array', () => {
    const claimsDetail = [
      { claim: 'A.', stance: 0.6, certainty: 0.8, evidence_class: 'reported_fact', verified: true },
      { claim: 'B.', stance: -0.4, certainty: 0.5 },
    ]
    const out = poolArticleToEnrichedSource(poolArticle({ claimsDetail } as never), null)
    expect(out.claimsDetail).toEqual(claimsDetail)
    // Per-claim facets survive the round trip — the whole point of the column.
    expect(out.claimsDetail?.[0].verified).toBe(true)
  })

  it('nulls a legacy or malformed claimsDetail instead of propagating a bad shape', () => {
    // Legacy rows (pre-column, and every row extracted before it existed) have no
    // per-claim data at all — there is no backfill, so null is the honest answer.
    expect(poolArticleToEnrichedSource(poolArticle(), null).claimsDetail).toBeNull()
    expect(poolArticleToEnrichedSource(poolArticle({ claimsDetail: null } as never), null).claimsDetail).toBeNull()
    expect(poolArticleToEnrichedSource(poolArticle({ claimsDetail: [] } as never), null).claimsDetail).toBeNull()
    expect(poolArticleToEnrichedSource(poolArticle({ claimsDetail: 'nope' } as never), null).claimsDetail).toBeNull()
    // One bad element invalidates the array — a partially-readable claim set would
    // silently under-report the article's claims to whatever reads this next.
    expect(
      poolArticleToEnrichedSource(
        poolArticle({ claimsDetail: [{ claim: 'ok', stance: 0.1 }, { claim: 'no stance' }] } as never),
        null,
      ).claimsDetail,
    ).toBeNull()
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

describe('stanceToPercent — the single publish point for the percent scale', () => {
  it('maps the scale as before, away from the bounds', () => {
    expect(stanceToPercent(0)).toBe(50)
    expect(stanceToPercent(0.4)).toBe(70)
    expect(stanceToPercent(-0.4)).toBe(30)
    expect(stanceToPercent(0.94)).toBe(97) // the settlement pin's own value
  })

  it('never publishes a literal 0 or 100 (daatan#1266)', () => {
    // The regression itself: a settlement interval endpoint is stance ±0.99,
    // which is 99.5 on this scale, and Math.round(99.5) is 100. That reached
    // 1,699 stored snapshots — 29% of everything written in the 48h before the
    // clamp shipped — and daatan renders it as a literal "100%".
    expect(stanceToPercent(0.99)).toBe(PUBLISH_PERCENT_MAX)
    expect(stanceToPercent(-0.99)).toBe(PUBLISH_PERCENT_MIN)
    expect(stanceToPercent(1)).toBe(PUBLISH_PERCENT_MAX)
    expect(stanceToPercent(-1)).toBe(PUBLISH_PERCENT_MIN)
  })

  it('clamps out-of-range input rather than trusting it', () => {
    expect(stanceToPercent(4)).toBe(PUBLISH_PERCENT_MAX)
    expect(stanceToPercent(-4)).toBe(PUBLISH_PERCENT_MIN)
  })

  it('leaves honestly-wide intervals alone — this is not the pin convention', () => {
    // [1,99], deliberately not the clock path's [3,97]: a forecast that means
    // 2-98 must be able to say so. Guards against someone "unifying" the two.
    expect(stanceToPercent(-0.96)).toBe(2)
    expect(stanceToPercent(0.96)).toBe(98)
  })
})
