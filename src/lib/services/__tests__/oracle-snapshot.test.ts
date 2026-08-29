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
  type EnrichedOracleSource,
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
  consensus_view: 'divided',
  fact_signal: 0.3,
  event_actors: 'Israel',
  event_target: 'Iran',
  is_occurrence: false,
  verified: true,
  facet: 'announcement',
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

  it('leaves claimsDetail undefined when the Oracle omitted it (F11, daatan#1237)', () => {
    const out = enrichOracleSources([oracleSource()], [searchResult()], new Map())
    expect(out[0].claimsDetail).toBeUndefined()
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
      consensusView: 'divided',
      factSignal: 0.3,
      eventActors: 'Israel',
      eventTarget: 'Iran',
      isOccurrence: false,
      verified: true,
      facet: 'announcement',
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

  it('leaves person/outlet identity undefined when identityByUrl has no entry for the URL (F11, daatan#1237)', () => {
    const out = enrichOracleSources([oracleSource()], [searchResult()], new Map())
    expect(out[0].personId).toBeUndefined()
    expect(out[0].personName).toBeUndefined()
    expect(out[0].outletId).toBeUndefined()
    expect(out[0].outletName).toBeUndefined()
  })

  it('stamps the response-level relevanceBar onto every source, defaulting to null when omitted (retro#393/#394, daatan#1289)', () => {
    const withBar = enrichOracleSources(
      [oracleSource(), oracleSource({ url: 'https://x.com/y' })],
      [searchResult()],
      new Map(),
      new Map(),
      0.7,
    )
    expect(withBar[0].relevanceBar).toBe(0.7)
    expect(withBar[1].relevanceBar).toBe(0.7)

    const withoutBar = enrichOracleSources([oracleSource()], [searchResult()], new Map())
    expect(withoutBar[0].relevanceBar).toBeNull()
  })

  it('stamps the response-level provenance.models onto every source, leaving fields undefined when omitted (daatan#1604/retro#627)', () => {
    const withProvenance = enrichOracleSources(
      [oracleSource(), oracleSource({ url: 'https://x.com/y' })],
      [searchResult()],
      new Map(),
      new Map(),
      null,
      {
        gatekeeper: 'nova-micro',
        extractor: 'claude-haiku-4-5',
        gatekeeper_prompt_version: 'v1',
        gatekeeper_prompt_hash: 'abc123',
        extractor_prompt_version: 'v1',
        extractor_prompt_hash: 'def456',
      },
    )
    expect(withProvenance[0]).toMatchObject({
      gatekeeperModel: 'nova-micro',
      extractorModel: 'claude-haiku-4-5',
      gatekeeperPromptVersion: 'v1',
      gatekeeperPromptHash: 'abc123',
      extractorPromptVersion: 'v1',
      extractorPromptHash: 'def456',
    })
    expect(withProvenance[1].extractorModel).toBe('claude-haiku-4-5')

    const withoutProvenance = enrichOracleSources([oracleSource()], [searchResult()], new Map())
    expect(withoutProvenance[0].extractorModel).toBeUndefined()
    expect(withoutProvenance[0].gatekeeperModel).toBeUndefined()
  })

  it('leaves settled/quantitativeEstimate/evidenceWeight/relevanceScore/authorLean/factSignal undefined when the Oracle omits them (F11, daatan#1237)', () => {
    const out = enrichOracleSources(
      [oracleSource({
        settled: undefined,
        settlement_event_date: undefined,
        quantitative_estimate: undefined,
        evidence_weight: undefined,
        relevance_score: undefined,
        author_lean: undefined,
        author_lean_certainty: undefined,
        consensus_view: undefined,
        fact_signal: undefined,
        event_actors: undefined,
        event_target: undefined,
        is_occurrence: undefined,
        verified: undefined,
        facet: undefined,
      })],
      [searchResult()],
      new Map(),
    )
    expect(out[0].settled).toBeUndefined()
    expect(out[0].settlementEventDate).toBeUndefined()
    expect(out[0].quantitativeEstimate).toBeUndefined()
    expect(out[0].evidenceWeight).toBeUndefined()
    expect(out[0].relevanceScore).toBeUndefined()
    expect(out[0].authorLean).toBeUndefined()
    expect(out[0].authorLeanCertainty).toBeUndefined()
    expect(out[0].consensusView).toBeUndefined()
    expect(out[0].factSignal).toBeUndefined()
    expect(out[0].eventActors).toBeUndefined()
    expect(out[0].eventTarget).toBeUndefined()
    expect(out[0].isOccurrence).toBeUndefined()
    expect(out[0].verified).toBeUndefined()
    expect(out[0].facet).toBeUndefined()
  })

  describe('omitted vs explicit-null fields (F11, daatan#1237)', () => {
    type FieldCase = { enrichedKey: keyof EnrichedOracleSource; oracleKey: keyof OracleSource }

    const FIELD_CASES: FieldCase[] = [
      { enrichedKey: 'settled', oracleKey: 'settled' },
      { enrichedKey: 'settlementEventDate', oracleKey: 'settlement_event_date' },
      { enrichedKey: 'quantitativeEstimate', oracleKey: 'quantitative_estimate' },
      { enrichedKey: 'evidenceWeight', oracleKey: 'evidence_weight' },
      { enrichedKey: 'relevanceScore', oracleKey: 'relevance_score' },
      { enrichedKey: 'evidenceClass', oracleKey: 'evidence_class' },
      { enrichedKey: 'authorLean', oracleKey: 'author_lean' },
      { enrichedKey: 'authorLeanCertainty', oracleKey: 'author_lean_certainty' },
      { enrichedKey: 'consensusView', oracleKey: 'consensus_view' },
      { enrichedKey: 'factSignal', oracleKey: 'fact_signal' },
      { enrichedKey: 'eventActors', oracleKey: 'event_actors' },
      { enrichedKey: 'eventTarget', oracleKey: 'event_target' },
      { enrichedKey: 'isOccurrence', oracleKey: 'is_occurrence' },
      { enrichedKey: 'verified', oracleKey: 'verified' },
      { enrichedKey: 'facet', oracleKey: 'facet' },
    ]

    it.each(FIELD_CASES)(
      '$enrichedKey: an omitted key stays undefined, does not overwrite a prior stored value',
      ({ enrichedKey, oracleKey }) => {
        const override = { [oracleKey]: undefined } as Partial<OracleSource>
        const out = enrichOracleSources([oracleSource(override)], [searchResult()], new Map())
        expect(out[0][enrichedKey]).toBeUndefined()
      },
    )

    it.each(FIELD_CASES)(
      '$enrichedKey: an explicit null is preserved — a real signal, does overwrite',
      ({ enrichedKey, oracleKey }) => {
        const override = { [oracleKey]: null } as Partial<OracleSource>
        const out = enrichOracleSources([oracleSource(override)], [searchResult()], new Map())
        expect(out[0][enrichedKey]).toBeNull()
      },
    )

    const IDENTITY_FIELDS: (keyof EnrichedOracleSource)[] = ['personId', 'personName', 'outletId', 'outletName']

    it.each(IDENTITY_FIELDS)(
      '%s: a missing identityByUrl entry stays undefined, does not overwrite a prior stored value',
      (field) => {
        const out = enrichOracleSources([oracleSource()], [searchResult()], new Map())
        expect(out[0][field]).toBeUndefined()
      },
    )

    it.each(IDENTITY_FIELDS)(
      '%s: a resolved identity entry with an explicit null is preserved — a real signal, does overwrite',
      (field) => {
        const out = enrichOracleSources(
          [oracleSource()],
          [searchResult()],
          new Map(),
          new Map([['https://reuters.com/a', { personId: null, personName: null, outletId: null, outletName: null }]]),
        )
        expect(out[0][field]).toBeNull()
      },
    )
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
    relevanceBar: 0.0,
    evidenceClass: 'reported_fact',
    authorLean: -0.4,
    authorLeanCertainty: 0.7,
    consensusView: 'divided',
    factSignal: 0.3,
    eventActors: 'Israel',
    eventTarget: 'Iran',
    isOccurrence: false,
    verified: true,
    facet: 'announcement',
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
      relevanceBar: 0.0,
      evidenceClass: 'reported_fact',
      authorLean: -0.4,
      authorLeanCertainty: 0.7,
      consensusView: 'divided',
      factSignal: 0.3,
      eventActors: 'Israel',
      eventTarget: 'Iran',
      isOccurrence: false,
      verified: true,
      facet: 'announcement',
      claimsDetail: null,
      carriedForward: false,
    })
  })

  // `consensusView` is a plain String column, so anything could be in it — the same
  // reason `evidenceClass` and `facet` are narrowed rather than cast. A legacy or
  // malformed value degrades to null instead of propagating a bad shape into a
  // snapshot that is typed as the three-member union.
  it('narrows an off-enum consensusView to null (retro#686, daatan#1653)', () => {
    expect(poolArticleToEnrichedSource(poolArticle({ consensusView: 'expects_no' }), null).consensusView)
      .toBe('expects_no')
    expect(poolArticleToEnrichedSource(poolArticle({ consensusView: 'unknown' }), null).consensusView)
      .toBeNull()
    expect(poolArticleToEnrichedSource(poolArticle({ consensusView: null }), null).consensusView)
      .toBeNull()
  })

  it('passes relevanceBar through from the pool row (retro#393/#394, daatan#1289)', () => {
    expect(poolArticleToEnrichedSource(poolArticle({ relevanceBar: 0.7 }), null).relevanceBar).toBe(0.7)
    expect(poolArticleToEnrichedSource(poolArticle({ relevanceBar: null }), null).relevanceBar).toBeNull()
  })

  it('passes extraction provenance through from the pool row (daatan#1604/retro#627)', () => {
    const out = poolArticleToEnrichedSource(
      poolArticle({
        extractorModel: 'claude-haiku-4-5',
        extractorPromptVersion: 'v1',
        extractorPromptHash: 'def456',
        gatekeeperModel: 'nova-micro',
        gatekeeperPromptVersion: 'v1',
        gatekeeperPromptHash: 'abc123',
      }),
      null,
    )
    expect(out).toMatchObject({
      extractorModel: 'claude-haiku-4-5',
      extractorPromptVersion: 'v1',
      extractorPromptHash: 'def456',
      gatekeeperModel: 'nova-micro',
      gatekeeperPromptVersion: 'v1',
      gatekeeperPromptHash: 'abc123',
    })
    expect(poolArticleToEnrichedSource(poolArticle({ extractorModel: null }), null).extractorModel).toBeNull()
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

  it('nulls an unrecognised facet rather than passing the raw string through', () => {
    expect(poolArticleToEnrichedSource(poolArticle({ facet: 'garbage' }), null).facet).toBeNull()
    expect(poolArticleToEnrichedSource(poolArticle({ facet: 'denial' }), null).facet).toBe('denial')
    expect(poolArticleToEnrichedSource(poolArticle({ facet: null }), null).facet).toBeNull()
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
    // `certainty` is non-optional on OracleClaimDetail AND required by retro's own
    // ClaimDetail — and `recomputeFromPool` feeds this output straight back to
    // /pool/aggregate (daatan#1264), where one claim missing it 422s the entire request.
    expect(
      poolArticleToEnrichedSource(
        poolArticle({ claimsDetail: [{ claim: 'ok', stance: 0.1 }] } as never),
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

  it('maps the per-source settled flag; absent or malformed → null (#1250)', () => {
    const snap = {
      sources: [
        { url: 'https://a.com/x', settled: true },
        { url: 'https://b.com/y', settled: 'yes' },
        { url: 'https://c.com/z' },
      ],
    }
    const out = oracleSnapshotToContributingSources(snap)
    expect(out.map((s) => s.settled)).toEqual([true, null, null])
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
