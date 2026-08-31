import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const prisma = {
    evidencePoolArticle: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    contextSnapshot: {
      findFirst: vi.fn(),
    },
    prediction: {
      findUnique: vi.fn(),
    },
  }
  // Array form (upsertCurrentVersion) resolves each already-started promise; callback
  // form (claimArticleForExtraction's versioning branch) runs against this same mocked
  // `evidencePoolArticle` — both match how the real transaction executes its statements
  // against one client, just without real isolation.
  return {
    prisma: {
      ...prisma,
      $transaction: vi.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => Promise<unknown>)(prisma),
      ),
    },
  }
})
vi.mock('@/lib/services/oracleClient', () => ({
  getOracleConfig: vi.fn(() => ({ baseUrl: 'http://oracle', key: 'k' })),
  oracleFetch: vi.fn(),
}))
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => mockLogger,
}))

import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { TRANSPORT_NULL_REASONS } from '@/lib/services/oracle'
import { REASK_DELAY_MS } from '@/lib/services/oracle-backfill'
import { Prisma } from '@prisma/client'
import {
  addArticlesToPool,
  articleIdsByUrl,
  getPoolArticles,
  getPublicArticlesByAuthorOutlet,
  setArticleExcluded,
  recomputeFromPool,
  pushCredibilityFeedback,
  claimArticleForExtraction,
  claimArticlesForExtraction,
  failClaimedArticles,
  publishedDaysBeforeClaim,
  STALE_PUBLISHED_REASON,
  STALE_PUBLISHED_REJECT_DAYS,
  STALE_PUBLISHED_WARN_DAYS,
  TERMINAL_POOL_REASONS,
  hashArticleContent,
  retireLegacyNullRows,
} from '../evidence-pool'
import type { EnrichedOracleSource } from '../oracle-snapshot'

const findMany = vi.mocked(prisma.evidencePoolArticle.findMany)
const findFirst = vi.mocked(prisma.evidencePoolArticle.findFirst)
const update = vi.mocked(prisma.evidencePoolArticle.update)
const create = vi.mocked(prisma.evidencePoolArticle.create)
const updateMany = vi.mocked(prisma.evidencePoolArticle.updateMany)
const count = vi.mocked(prisma.evidencePoolArticle.count)
const snapshotFindFirst = vi.mocked(prisma.contextSnapshot.findFirst)
const predictionFindUnique = vi.mocked(prisma.prediction.findUnique)
const mockGetOracleConfig = vi.mocked(getOracleConfig)
const mockOraculFetch = vi.mocked(oracleFetch)

/** A P2002 unique-constraint-violation error, as Prisma throws it. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.8.0',
  })
}

const source = (over: Partial<EnrichedOracleSource> = {}): EnrichedOracleSource => ({
  sourceId: 's1',
  sourceName: 'Reuters',
  url: 'https://reuters.com/a',
  stance: 0.5,
  certainty: 0.8,
  credibilityWeight: 1,
  claims: ['it will happen'],
  title: 'Headline',
  publishedAt: '2026-06-18',
  author: 'Jane Doe',
  personId: null,
  personName: null,
  outletId: null,
  outletName: null,
  settled: null,
  settlementEventDate: null,
  quantitativeEstimate: null,
  evidenceWeight: null,
  relevanceScore: null,
  relevanceBar: null,
  evidenceClass: null,
  authorLean: null,
  authorLeanCertainty: null,
  consensusView: null,
  factSignal: null,
  eventActors: null,
  eventTarget: null,
  isOccurrence: null,
  verified: null,
  claimsDetail: null,
  carriedForward: false,
  ...over,
})

/** A single-URL claim-id map, as `articleIdsByUrl`/callers would build it —
 *  `addArticlesToPool` always writes via `update({ where: { id } })` when
 *  the map has an entry, which is the normal case for every real caller. */
const idFor = (url: string, id = 'row-1'): Map<string, string> => new Map([[url, id]])

describe('addArticlesToPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({} as never)
  })

  it('updates the claimed row by id with the extracted signal', async () => {
    await addArticlesToPool('pred-1', [source()], 'analyze', idFor('https://reuters.com/a'))

    expect(update).toHaveBeenCalledTimes(1)
    const call = update.mock.calls[0][0] as { where: { id: string }; data: Record<string, unknown> }
    expect(call.where).toEqual({ id: 'row-1' })
    expect(call.data).toMatchObject({
      url: 'https://reuters.com/a',
      stance: 0.5,
      certainty: 0.8,
      origin: 'analyze',
    })
  })

  it('persists the resolved author identity on the pool row (Phase 2)', async () => {
    await addArticlesToPool(
      'pred-1',
      [source({ author: 'בן כספית', personId: 'p-9', personName: 'Ben Caspit' })],
      'news-indexer',
      idFor('https://reuters.com/a'),
    )
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ author: 'בן כספית', personId: 'p-9', personName: 'Ben Caspit' })
  })

  it('never writes `excluded` (an admin exclusion decision must survive re-discovery)', async () => {
    await addArticlesToPool('pred-1', [source()], 'news-indexer', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).not.toHaveProperty('excluded')
  })

  it('updates each article in the batch independently, by its own claimed id', async () => {
    await addArticlesToPool(
      'pred-1',
      [source({ url: 'https://a.com/1' }), source({ url: 'https://b.com/2' })],
      'backfill',
      new Map([
        ['https://a.com/1', 'row-a'],
        ['https://b.com/2', 'row-b'],
      ]),
    )
    expect(update).toHaveBeenCalledTimes(2)
    const ids = update.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)
    expect(ids.sort()).toEqual(['row-a', 'row-b'])
  })

  it('falls back to a version-aware upsert when a source has no claimed id', async () => {
    // Defensive path — no current caller should hit this, since all of them build the
    // map from the same claim step that produced `sources`, but a source silently
    // absent from the map must not be dropped on the floor.
    findFirst.mockResolvedValue(null)
    create.mockResolvedValue({} as never)
    await addArticlesToPool('pred-1', [source()], 'analyze', new Map())
    expect(update).not.toHaveBeenCalled()
    expect(findFirst).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1', urlHash: hashUrl('https://reuters.com/a'), supersededAt: null },
    })
    expect(create).toHaveBeenCalledTimes(1)
    const call = create.mock.calls[0][0] as { data: Record<string, unknown> }
    // Omitted (not DbNull) — Prisma treats an absent key on `create()` as SQL NULL for
    // this nullable Json column, same end state, no separate default needed.
    expect(call.data.claimsDetail).toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: 'pred-1', url: 'https://reuters.com/a', origin: 'analyze' }),
      'event=evidence_pool_write_no_claim_id',
    )
  })

  it('falls back to superseding the current row when a source has no claimed id but one already exists', async () => {
    const current = { id: 'existing-1', version: 1 }
    findFirst.mockResolvedValue(current as never)
    update.mockResolvedValue({} as never)
    create.mockResolvedValue({} as never)
    await addArticlesToPool('pred-1', [source()], 'analyze', new Map())
    expect(update).toHaveBeenCalledWith({ where: { id: 'existing-1' }, data: { supersededAt: expect.any(Date) } })
    const createCall = create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createCall.data).toMatchObject({ version: 2, supersedesId: 'existing-1' })
  })

  it('passes settled/quantitativeEstimate straight through', async () => {
    await addArticlesToPool(
      'pred-1',
      [source({ settled: true, quantitativeEstimate: 0.22 })],
      'analyze',
      idFor('https://reuters.com/a'),
    )
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ settled: true, quantitativeEstimate: 0.22 })
  })

  it('passes evidenceWeight straight through', async () => {
    await addArticlesToPool('pred-1', [source({ evidenceWeight: 4.0 })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ evidenceWeight: 4.0 })
  })

  it('passes relevanceScore straight through', async () => {
    await addArticlesToPool('pred-1', [source({ relevanceScore: 0.85 })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ relevanceScore: 0.85 })
  })

  it('persists the shadow relevanceBar (retro#393/#394, daatan#1289)', async () => {
    await addArticlesToPool('pred-1', [source({ relevanceBar: 0.7 })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ relevanceBar: 0.7 })
  })

  it('persists the shadow extraction provenance (daatan#1604/retro#627)', async () => {
    await addArticlesToPool('pred-1', [source({
      extractorModel: 'claude-haiku-4-5',
      extractorPromptVersion: 'v1',
      extractorPromptHash: 'def456',
      gatekeeperModel: 'nova-micro',
      gatekeeperPromptVersion: 'v1',
      gatekeeperPromptHash: 'abc123',
    })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({
      extractorModel: 'claude-haiku-4-5',
      extractorPromptVersion: 'v1',
      extractorPromptHash: 'def456',
      gatekeeperModel: 'nova-micro',
      gatekeeperPromptVersion: 'v1',
      gatekeeperPromptHash: 'abc123',
    })
  })

  it('persists the Oracul build stamp (daatan#1669)', async () => {
    await addArticlesToPool('pred-1', [source({
      oracleVersion: '1.4.0+build.38912',
      oracleGitSha: 'c335796afb3e25158c12a965dc05ac71b2e65346',
    })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({
      oracleVersion: '1.4.0+build.38912',
      oracleGitSha: 'c335796afb3e25158c12a965dc05ac71b2e65346',
    })
  })

  it('writes null Oracul build fields, never throws, when the response carried no provenance (daatan#1669)', async () => {
    await addArticlesToPool('pred-1', [source({ oracleVersion: null, oracleGitSha: null })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ oracleVersion: null, oracleGitSha: null })
  })

  it('persists the shadow authorLean/authorLeanCertainty', async () => {
    // Author-scoring lane (retro #308/#309) — written to the pool row but never read by any
    // estimate. Verifies the un-fusing shadow column is actually persisted.
    await addArticlesToPool(
      'pred-1',
      [source({ authorLean: -0.6, authorLeanCertainty: 0.4 })],
      'analyze',
      idFor('https://reuters.com/a'),
    )
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ authorLean: -0.6, authorLeanCertainty: 0.4 })
  })

  it('persists the shadow consensusView (retro#686, daatan#1653)', async () => {
    // What the article says everyone ELSE expects — the same shape of judgement as
    // authorLean, for Phase 3 S2's shared-information detector. Written to the pool
    // row, read by nothing, never sent to /pool/aggregate.
    await addArticlesToPool(
      'pred-1',
      [source({ consensusView: 'expects_no' })],
      'analyze',
      idFor('https://reuters.com/a'),
    )
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ consensusView: 'expects_no' })
  })

  it('leaves a stored consensusView alone when the Oracul omits it (F11, daatan#1237)', async () => {
    // The failure mode #1237 recorded: a re-touch that carries no opinion this run
    // must not erase one we already hold. `undefined` tells Prisma to skip the column;
    // an explicit null would overwrite. There is no backfill, so an erased value is gone.
    const { consensusView: _omitted, ...withoutConsensusView } = source()
    await addArticlesToPool(
      'pred-1',
      [withoutConsensusView],
      'analyze',
      idFor('https://reuters.com/a'),
    )
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.consensusView).toBeUndefined()
  })

  it('persists the shadow factSignal + facets', async () => {
    // Estimator lane (retro #313) — the fact-lane counterpart of stance, written to the pool
    // row but never read by any estimate and never sent to /pool/aggregate. Verifies all five
    // shadow columns are actually persisted.
    const facts = {
      factSignal: 0.3,
      eventActors: 'Israel',
      eventTarget: 'Iran',
      isOccurrence: false,
      verified: true,
    }
    await addArticlesToPool('pred-1', [source(facts)], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject(facts)
  })

  it('persists claimsDetail — the per-claim layer', async () => {
    // F1/F15 (daatan#1235, retro#364). Every other extracted column on this row is a
    // REDUCTION; this is the layer they reduce from, and it is where the inputs used
    // to die. Storage only — nothing reads it, and it is never sent to /pool/aggregate.
    const claimsDetail = [
      { claim: 'The vote was scheduled.', quote: 'The speaker set a date.', stance: 0.6, certainty: 0.8, evidence_class: 'reported_fact' as const, fact_signal: 0.2, is_occurrence: false, verified: true },
      { claim: 'A minister denied it.', stance: -0.4, certainty: 0.5, evidence_class: 'opinion' as const },
    ]
    await addArticlesToPool('pred-1', [source({ claimsDetail })], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ claimsDetail })
  })

  it('never NULLS stored claimsDetail on an update that merely omits it', async () => {
    // The daatan#1237 failure mode, deliberately not repeated here: a re-touch that
    // carries no per-claim data (a recompute, an older Oracul build, a partial
    // response) must leave what we already hold alone. `undefined` tells Prisma to
    // skip the column; there is no backfill, so an erased row is gone for good.
    await addArticlesToPool('pred-1', [source()], 'analyze', idFor('https://reuters.com/a'))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.claimsDetail).toBeUndefined()
    expect('claimsDetail' in call.data).toBe(true) // present-but-undefined, i.e. skipped
  })
})

describe('getPoolArticles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists a forecast\'s current-version pool, most recently added first (daatan#1382)', async () => {
    findMany.mockResolvedValue([] as never)
    await getPoolArticles('pred-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1', supersededAt: null },
      orderBy: { addedAt: 'desc' },
    })
  })

  it('includes superseded rows when includeSuperseded is true (admin correction-history view)', async () => {
    findMany.mockResolvedValue([] as never)
    await getPoolArticles('pred-1', { includeSuperseded: true })
    expect(findMany).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1' },
      orderBy: { addedAt: 'desc' },
    })
  })
})

describe('getPublicArticlesByAuthorOutlet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by exact author + outletName match, excluding admin-excluded and superseded rows', async () => {
    findMany.mockResolvedValue([] as never)
    await getPublicArticlesByAuthorOutlet('Ben Caspit', 'maariv')
    expect(findMany).toHaveBeenCalledWith({
      where: { author: 'Ben Caspit', outletName: 'maariv', excluded: false, supersededAt: null },
      orderBy: { addedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        url: true,
        publishedDate: true,
        predictionId: true,
        prediction: { select: { claimText: true, status: true } },
      },
    })
  })

  it('flattens the joined prediction fields onto each row', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'Title',
        url: 'https://maariv.co.il/a1',
        publishedDate: '2026-07-01',
        predictionId: 'pred-1',
        prediction: { claimText: 'Will X happen?', status: 'RESOLVED_CORRECT' },
      },
    ] as never)

    const rows = await getPublicArticlesByAuthorOutlet('Ben Caspit', 'maariv')
    expect(rows).toEqual([{
      id: 'a1',
      title: 'Title',
      url: 'https://maariv.co.il/a1',
      publishedDate: '2026-07-01',
      predictionId: 'pred-1',
      predictionClaimText: 'Will X happen?',
      predictionStatus: 'RESOLVED_CORRECT',
    }])
  })

  it('respects a caller-supplied limit', async () => {
    findMany.mockResolvedValue([] as never)
    await getPublicArticlesByAuthorOutlet('Ben Caspit', 'maariv', 5)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })
})

describe('setArticleExcluded', () => {
  beforeEach(() => vi.clearAllMocks())

  it('excludes an article that belongs to the given forecast', async () => {
    findFirst.mockResolvedValue({ id: 'art-1', predictionId: 'pred-1' } as never)
    update.mockResolvedValue({ id: 'art-1', excluded: true } as never)

    const result = await setArticleExcluded('pred-1', 'art-1', true)

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'art-1', predictionId: 'pred-1' } })
    expect(update).toHaveBeenCalledWith({ where: { id: 'art-1' }, data: { excluded: true } })
    expect(result).toMatchObject({ excluded: true })
  })

  it('returns null without updating when the article does not belong to the forecast', async () => {
    findFirst.mockResolvedValue(null)

    const result = await setArticleExcluded('pred-1', 'someone-elses-article', true)

    expect(update).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

const poolArticle = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'art-1',
  predictionId: 'pred-1',
  url: 'https://reuters.com/a',
  urlHash: 'hash-1',
  title: 'Headline',
  source: 'reuters.com',
  publishedDate: '2026-07-01',
  stance: 0.5,
  certainty: 0.8,
  credibilityWeight: 1.0,
  claims: [],
  settled: false,
  settlementEventDate: null,
  quantitativeEstimate: null,
  evidenceWeight: 0.6,
  relevanceScore: 0.9,
  relevanceBar: 0.0,
  evidenceClass: 'reported_fact',
  origin: 'analyze',
  excluded: false,
  status: 'COMPLETE',
  author: null,
  outletName: null,
  authorLean: null,
  authorLeanCertainty: null,
  addedAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  ...over,
})


const AGGREGATE = {
  mean: 0.6,
  std: 0.25,
  ci_low: 0.3,
  ci_high: 0.9,
  articles_used: 4,
  settled: false,
  insufficient_data: false,
  reason: null,
}

describe('recomputeFromPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOracleConfig.mockReturnValue({ baseUrl: 'http://oracle', key: 'k' })
  })

  it('returns the aggregate, converted to camelCase, with the pool census attached', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2' }),
      poolArticle({ id: 'art-3', excluded: true }),
      poolArticle({ id: 'art-4', stance: null }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    expect(out).toEqual({
      mean: 0.6,
      std: 0.25, // carried through — the snapshot's std must describe the pool, not one article
      ciLow: 0.3,
      ciHigh: 0.9,
      articlesUsed: 4,
      settled: false,
      insufficientData: false,
      reason: null,
      poolSize: 4,
      usableSize: 2,
      excludedCount: 1,
      incompleteCount: 1,
      // The exact rows that were POSTed — art-1 and art-2. The excluded (art-3) and
      // stance-less (art-4) rows are dropped, so the caller can list precisely the
      // articles the estimate averages.
      usableArticles: [poolArticle(), poolArticle({ id: 'art-2' })],
      // AGGREGATE has no evidence_mass/n_eff/age_adjusted_mass — retro omits them
      // on older responses, and recomputeFromPool must fail open to null rather
      // than throw or silently drop the keys (daatan#1563).
      evidenceMass: null,
      nEff: null,
      ageAdjustedMass: null,
    })
  })

  it('surfaces evidence_mass/n_eff/age_adjusted_mass from the pool aggregate (daatan#1563)', async () => {
    findMany.mockResolvedValue([poolArticle(), poolArticle({ id: 'art-2' })] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...AGGREGATE, evidence_mass: 3.42, n_eff: 2.1, age_adjusted_mass: 3.9 }),
    } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    expect(out?.evidenceMass).toBe(3.42)
    expect(out?.nEff).toBe(2.1)
    expect(out?.ageAdjustedMass).toBe(3.9)
  })

  it('queries only current-version rows, excluding superseded ones (daatan#1382)', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { predictionId: 'pred-1', supersededAt: null },
    })
  })

  it('returns usableArticles equal to the rows it POSTed — nothing more, nothing less', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2', excluded: true }),
      poolArticle({ id: 'art-3', relevanceScore: null }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    const posted = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body).sources
    expect(out?.usableArticles).toHaveLength(posted.length)
    expect(out?.usableArticles.map((a) => a.id)).toEqual(['art-1'])
  })

  it('sends each row\'s settlement anchor date and the claim window metadata', async () => {
    findMany.mockResolvedValue([
      poolArticle({ settled: true, settlementEventDate: '2026-07-14' }),
      poolArticle({ id: 'art-2' }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', 'ARRIVAL' as never, new Date('2026-07-19T23:59:59Z'), new Date('2026-07-04T10:00:00Z'), 'SCHEDULED' as never)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources[0].settlement_event_date).toBe('2026-07-14')
    expect(body.sources[1].settlement_event_date).toBeNull()
    expect(body.claim_created_at).toBe('2026-07-04T10:00:00.000Z')
    expect(body.claim_archetype).toBe('scheduled')
  })

  it('omits claim_created_at/claim_archetype entirely when unclassified — retro must fail open', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect('claim_created_at' in body).toBe(false)
    expect('claim_archetype' in body).toBe(false)
  })

  // daatan#1264 — the settlement match gate needs BOTH `question` and per-source
  // `claims_detail`. With only one of them retro skips explicitly (`no_question` /
  // `no_claim_detail`), so a pin published through the recompute path would bypass a
  // gate that has been ENFORCING on `/forecast` since 2026-08-03 (retro#395).
  it('sends the claim text and the per-claim layer the settlement gate votes on', async () => {
    const claimsDetail = [
      { claim: 'The vote passed.', quote: 'Parliament passed it Tuesday.', stance: 0.9, certainty: 0.9, settled: true, event_date: '2026-07-14' },
      { claim: 'Turnout was high.', stance: 0.2, certainty: 0.5, settled: false },
    ]
    findMany.mockResolvedValue([poolArticle({ claimsDetail, outletName: 'Reuters' })] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null, null, null, 'Will the bill pass by July?')

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.question).toBe('Will the bill pass by July?')
    expect(body.sources[0].claims_detail).toEqual(claimsDetail)
    // Vote identity — retro attributes each vote via `outlet or url`.
    expect(body.sources[0].url).toBe('https://reuters.com/a')
    expect(body.sources[0].outlet).toBe('Reuters')
  })

  it('sends added_at (ingest time) alongside published_date, not instead of it', async () => {
    // daatan#1362. retro computes `days_since_last_complete` from max(added_at) — a
    // freshness-of-COVERAGE signal ("is new evidence still arriving for this claim?").
    // published_date cannot stand in: this row was published in January and pooled in
    // July, and it is the July date that says the pool is still being fed.
    findMany.mockResolvedValue([
      poolArticle({ publishedDate: '2026-01-15', addedAt: new Date('2026-07-20T08:30:00Z') }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources[0].added_at).toBe('2026-07-20T08:30:00.000Z')
    expect(body.sources[0].published_date).toBe('2026-01-15')
  })

  it('only ever sends added_at for COMPLETE rows — the usable filter is what guarantees it', async () => {
    // Pins that the newest row by addedAt is incomplete, and its timestamp must NOT reach
    // retro, or days_since_last_complete would read 0 for a pool whose last actual
    // extraction was weeks ago.
    findMany.mockResolvedValue([
      poolArticle({ id: 'pending', stance: null, addedAt: new Date('2026-07-30T00:00:00Z') }),
      poolArticle({ id: 'complete', addedAt: new Date('2026-07-02T00:00:00Z') }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].added_at).toBe('2026-07-02T00:00:00.000Z')
  })

  it('excludes a FAILED row even when it still carries stale non-null fields from a prior extraction (daatan#1445)', async () => {
    // A retry that flips a row to FAILED doesn't null out the fields written by its last
    // successful pass — the usable filter can't infer completeness from those fields being
    // non-null. It must check `status` directly.
    findMany.mockResolvedValue([
      poolArticle({ id: 'stale-failed', status: 'FAILED', addedAt: new Date('2026-07-30T00:00:00Z') }),
      poolArticle({ id: 'complete', addedAt: new Date('2026-07-02T00:00:00Z') }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].added_at).toBe('2026-07-02T00:00:00.000Z')
  })

  it('omits question entirely when there is no usable claim text — retro must skip, not guess', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)
    expect('question' in JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)).toBe(false)

    // Below retro's `min_length=5`: sending it would 422 the WHOLE aggregate and drop the
    // estimate to the single-run fallback — far worse than skipping the gate.
    mockOraculFetch.mockClear()
    await recomputeFromPool('pred-1', null, null, null, null, '  hi  ')
    expect('question' in JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)).toBe(false)
  })

  it('nulls a legacy or malformed claims_detail instead of 422ing the whole aggregate', async () => {
    findMany.mockResolvedValue([
      poolArticle(), // legacy row: column never written
      poolArticle({ id: 'art-2', claimsDetail: [{ claim: 'no certainty', stance: 0.4 }] }),
      poolArticle({ id: 'art-3', claimsDetail: 'nope' }),
    ] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null, null, null, 'Will the bill pass by July?')

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    // retro's ClaimDetail requires claim+stance+certainty; one bad element would reject the
    // request outright, so an unusable value is dropped to null and the gate skips that row.
    expect(body.sources.map((s: { claims_detail: unknown }) => s.claims_detail)).toEqual([null, null, null])
  })

  it("drops admin-excluded articles from the aggregate, so an exclusion moves the number", async () => {
    findMany.mockResolvedValue([poolArticle(), poolArticle({ id: 'art-2', excluded: true })] as never)
    mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const [, , init] = mockOraculFetch.mock.calls[0]
    expect(JSON.parse((init as { body: string }).body).sources).toHaveLength(1)
  })

  it('surfaces insufficient_data rather than passing off a non-estimate as one', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...AGGREGATE, insufficient_data: true, reason: 'no_decisive_signal' }),
    } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    expect(out).toMatchObject({ insufficientData: true, reason: 'no_decisive_signal' })
  })

  it('returns null when the Oracul is not configured', async () => {
    mockGetOracleConfig.mockReturnValue(null)
    expect(await recomputeFromPool('pred-1', null, null)).toBeNull()
    expect(mockOraculFetch).not.toHaveBeenCalled()
  })

  it('returns null when nothing in the pool is usable', async () => {
    findMany.mockResolvedValue([poolArticle({ excluded: true }), poolArticle({ id: 'a2', certainty: null })] as never)
    expect(await recomputeFromPool('pred-1', null, null)).toBeNull()
    expect(mockOraculFetch).not.toHaveBeenCalled()
  })

  // Both failure paths return null rather than throwing: the caller falls back to its
  // single-run forecast, so a flaky Oracul degrades the estimate instead of dropping it.
  it('returns null (never throws) on a non-OK status', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({ ok: false, status: 503 } as never)
    await expect(recomputeFromPool('pred-1', null, null)).resolves.toBeNull()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('returns null (never throws) when the fetch rejects', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockRejectedValue(new Error('network down'))
    await expect(recomputeFromPool('pred-1', null, null)).resolves.toBeNull()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  // daatan#1507 — log-only shadow check: the pool already shows the event happened
  // before the claim was created (the Brent-crude case, daatan#1474 swing review #4).
  describe('already-occurred-at-creation audit (daatan#1507)', () => {
    const claimCreatedAt = new Date('2026-07-29T00:00:00Z')
    const warnedAlreadyOccurred = () =>
      mockLogger.warn.mock.calls.some((call) =>
        String(call[1]).includes('already_occurred_at_creation'),
      )

    it('warns when >= 5 usable rows at stance >= 0.7 all predate claim creation', async () => {
      findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) =>
          poolArticle({ id: `art-${i}`, stance: 0.8, publishedDate: '2026-07-23' }),
        ) as never,
      )
      mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

      await recomputeFromPool('pred-1', null, null, claimCreatedAt)

      expect(warnedAlreadyOccurred()).toBe(true)
    })

    it('does not warn below the row-count threshold', async () => {
      findMany.mockResolvedValue(
        Array.from({ length: 4 }, (_, i) =>
          poolArticle({ id: `art-${i}`, stance: 0.8, publishedDate: '2026-07-23' }),
        ) as never,
      )
      mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

      await recomputeFromPool('pred-1', null, null, claimCreatedAt)

      expect(warnedAlreadyOccurred()).toBe(false)
    })

    it('does not warn when the strong rows are AFTER claim creation, not before', async () => {
      findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) =>
          poolArticle({ id: `art-${i}`, stance: 0.8, publishedDate: '2026-08-05' }),
        ) as never,
      )
      mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

      await recomputeFromPool('pred-1', null, null, claimCreatedAt)

      expect(warnedAlreadyOccurred()).toBe(false)
    })

    it('does not warn when claimCreatedAt is unknown — nothing to compare against', async () => {
      findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) =>
          poolArticle({ id: `art-${i}`, stance: 0.8, publishedDate: '2026-07-23' }),
        ) as never,
      )
      mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

      await recomputeFromPool('pred-1', null, null, null)

      expect(warnedAlreadyOccurred()).toBe(false)
    })

    it('never blocks or changes the returned aggregate — log-only', async () => {
      findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) =>
          poolArticle({ id: `art-${i}`, stance: 0.8, publishedDate: '2026-07-23' }),
        ) as never,
      )
      mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

      const out = await recomputeFromPool('pred-1', null, null, claimCreatedAt)

      expect(out?.mean).toBe(AGGREGATE.mean)
    })
  })
})

describe('pushCredibilityFeedback', () => {
  const resolvedAt = new Date('2026-07-17T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOracleConfig.mockReturnValue({ baseUrl: 'http://oracle', key: 'k' })
    snapshotFindFirst.mockResolvedValue(null as never)
    predictionFindUnique.mockResolvedValue(null as never)
  })

  it('does nothing when the Oracul is not configured', async () => {
    mockGetOracleConfig.mockReturnValue(null)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(findMany).not.toHaveBeenCalled()
    expect(mockOraculFetch).not.toHaveBeenCalled()
  })

  it('does nothing when the pool is empty', async () => {
    findMany.mockResolvedValue([] as never)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(mockOraculFetch).not.toHaveBeenCalled()
  })

  it('reads only current-version pool rows, so a corrected article is not double-credited (daatan#1382)', async () => {
    findMany.mockResolvedValue([] as never)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(findMany).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1', supersededAt: null },
      orderBy: { addedAt: 'desc' },
    })
  })

  it('excludes admin-excluded, opinion-class, and sourceless/stanceless articles', async () => {
    findMany.mockResolvedValue([
      poolArticle({ id: 'art-excluded', excluded: true }),
      poolArticle({ id: 'art-opinion', evidenceClass: 'opinion' }),
      poolArticle({ id: 'art-no-source', source: null }),
      poolArticle({ id: 'art-no-stance', stance: null }),
    ] as never)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(mockOraculFetch).not.toHaveBeenCalled()
  })

  it('sends author_signals for non-excluded rows with an author_lean, opinion included', async () => {
    findMany.mockResolvedValue([
      poolArticle({ id: 'art-opinion', evidenceClass: 'opinion', author: 'Ben Caspit', outletName: 'maariv', authorLean: 0.9, authorLeanCertainty: 0.8 }),
      poolArticle({ id: 'art-excluded', excluded: true, authorLean: 0.5 }),
      poolArticle({ id: 'art-no-lean' }),
    ] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1, author_signals_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', false, resolvedAt)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.author_signals).toHaveLength(1)
    expect(body.author_signals[0]).toEqual({
      author: 'Ben Caspit',
      outlet_name: 'maariv',
      author_lean: 0.9,
      author_lean_certainty: 0.8,
      evidence_class: 'opinion',
    })
  })

  it('still pushes when only the author lane has signal — the stance lane being all-opinion must not gate it', async () => {
    findMany.mockResolvedValue([
      poolArticle({ id: 'art-opinion', evidenceClass: 'opinion', author: 'Pundit', authorLean: -0.7 }),
    ] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 0, author_signals_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    expect(mockOraculFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources).toHaveLength(0)
    expect(body.author_signals).toHaveLength(1)
  })

  it('posts usable sources to /leaderboard/ingest, mapped to the wire shape', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2', excluded: true }),
      poolArticle({ id: 'art-3', evidenceClass: 'opinion' }),
    ] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    expect(mockOraculFetch).toHaveBeenCalledTimes(1)
    const [, path, init] = mockOraculFetch.mock.calls[0]
    expect(path).toBe('/leaderboard/ingest')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.prediction_id).toBe('pred-1')
    expect(body.outcome).toBe(true)
    expect(body.resolved_at).toBe(resolvedAt.toISOString())
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0]).toMatchObject({
      source: 'reuters.com',
      stance: 0.5,
      evidence_class: 'reported_fact',
      credibility_weight: 1.0,
      evidence_weight: 0.6,
    })
  })

  // retro#356: retro conditions its shadow-hazard base rate on this. Its
  // Literal is lowercase where daatan's enum is uppercase, and on a
  // fire-and-forget call a 422 would only ever be a warning line.
  it('sends claim_archetype lowercased for retro’s Literal', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    predictionFindUnique.mockResolvedValue({ claimArchetype: 'DIFFUSE' } as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.claim_archetype).toBe('diffuse')
  })

  // "unclassified" and "classified as NONE" are different facts: retro counts an
  // absent archetype toward no base rate at all, while 'none' is a real class.
  it('omits claim_archetype entirely when the claim is unclassified', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    predictionFindUnique.mockResolvedValue({ claimArchetype: null } as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect('claim_archetype' in body).toBe(false)
  })

  it('sends the NONE archetype as a real class, not as an omission', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    predictionFindUnique.mockResolvedValue({ claimArchetype: 'NONE' } as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.claim_archetype).toBe('none')
  })

  // daatan#1451: retro's settlement-pin ledger records nothing without this field,
  // and its `mean` is bounded [-1, 1] — sending the stored percent is a 422.
  it('sends settlement_snapshot converted from percent to stance space', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    snapshotFindFirst.mockResolvedValue({
      oracleSnapshot: { mean: 97, ciLow: 91, ciHigh: 99, settled: true },
    } as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', false, resolvedAt)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.settlement_snapshot.settled).toBe(true)
    expect(body.settlement_snapshot.mean).toBeCloseTo(0.94, 10)
    expect(body.settlement_snapshot.ci_low).toBeCloseTo(0.82, 10)
    expect(body.settlement_snapshot.ci_high).toBeCloseTo(0.98, 10)
  })

  it('reads the pin from the latest settled non-clock snapshot at or before resolution', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    expect(snapshotFindFirst).toHaveBeenCalledWith({
      where: {
        predictionId: 'pred-1',
        kind: { not: 'clock' },
        insufficientData: false,
        createdAt: { lte: resolvedAt },
        oracleSnapshot: { path: ['settled'], equals: true },
      },
      orderBy: { createdAt: 'desc' },
      select: { oracleSnapshot: true },
    })
  })

  it('omits settlement_snapshot entirely when the claim was never pinned', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect('settlement_snapshot' in body).toBe(false)
  })

  it('still pushes a pinned claim whose pool holds nothing usable', async () => {
    findMany.mockResolvedValue([] as never)
    snapshotFindFirst.mockResolvedValue({
      oracleSnapshot: { mean: 3, ciLow: 1, ciHigh: 9, settled: true },
    } as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 0 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    expect(mockOraculFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((mockOraculFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources).toHaveLength(0)
    expect(body.settlement_snapshot.mean).toBeCloseTo(-0.94, 10)
  })

  it('logs the ingest result on success', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', false, resolvedAt)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: 'pred-1',
        outcome: false,
        sourcesRecorded: 1,
        alreadyIngested: false,
      }),
      'event=credibility_feedback_ingest',
    )
  })

  it('never throws when the Oracul returns a non-OK status', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockResolvedValue({ ok: false, status: 500 } as never)
    await expect(pushCredibilityFeedback('pred-1', true, resolvedAt)).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('never throws when the fetch itself rejects', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOraculFetch.mockRejectedValue(new Error('network down'))
    await expect(pushCredibilityFeedback('pred-1', true, resolvedAt)).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})

describe('hashArticleContent', () => {
  it('is stable for the same title+snippet', () => {
    expect(hashArticleContent('T', 'S')).toBe(hashArticleContent('T', 'S'))
  })

  it('changes when the snippet changes (a live-blog update)', () => {
    expect(hashArticleContent('T', 'S1')).not.toBe(hashArticleContent('T', 'S2'))
  })

  it('changes when the title changes', () => {
    expect(hashArticleContent('T1', 'S')).not.toBe(hashArticleContent('T2', 'S'))
  })
})

const article = (over: Partial<{ url: string; title: string; snippet: string; source: string | null; publishedAt: string | null; publishedAtSource: string | null }> = {}) => ({
  url: 'https://reuters.com/a',
  title: 'Headline',
  snippet: 'A snippet',
  source: 'reuters.com',
  publishedAt: '2026-07-01',
  publishedAtSource: 'page',
  ...over,
})

describe('claimArticleForExtraction', () => {
  beforeEach(() => vi.clearAllMocks())

  /** The row `findFirst` resolves after a P2002. Defaults to matching `article()`'s
   *  contentHash (the same-content branch) with `status: 'COMPLETE'`; pass
   *  `contentHash: 'stale-hash'` or `null` to exercise the content-changed branch
   *  instead, or `status` to exercise `skip_pending` (PENDING/FAILED) vs `skip_complete`
   *  (COMPLETE) on the same-content branch. */
  const currentRow = (
    over: Partial<{ id: string; version: number; contentHash: string | null; status: string }> = {},
  ) => ({
    id: 'current-1',
    version: 1,
    contentHash: hashArticleContent('Headline', 'A snippet'),
    status: 'COMPLETE',
    ...over,
  })

  it('claims via a plain create when no row exists yet for (predictionId, urlHash)', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)

    const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')

    expect(result).toEqual({ result: 'claimed', articleId: 'new-1' })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        predictionId: 'pred-1',
        url: 'https://reuters.com/a',
        urlHash: hashUrl('https://reuters.com/a'),
        contentHash: hashArticleContent('Headline', 'A snippet'),
        status: 'PENDING',
        origin: 'news-indexer',
      }),
      select: { id: true },
    })
    expect(findFirst).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('throws if a P2002 lands but no current (non-superseded) row can be found', async () => {
    // Shouldn't happen in practice — the partial unique index only rejects the create
    // while a non-superseded row exists — but a silent null here would be worse than a
    // loud failure.
    create.mockRejectedValue(uniqueViolation())
    findFirst.mockResolvedValue(null)
    await expect(claimArticleForExtraction('pred-1', article(), 'news-indexer')).rejects.toThrow(
      /no current row found/,
    )
    expect(findFirst).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1', urlHash: hashUrl('https://reuters.com/a'), supersededAt: null },
    })
  })

  describe('content changed on the current row', () => {
    it('supersedes the old row and inserts a new version, in that order', async () => {
      create.mockImplementationOnce(() => {
        throw uniqueViolation()
      })
      findFirst.mockResolvedValue(currentRow({ contentHash: 'stale-hash' }) as never)
      update.mockResolvedValueOnce({} as never)
      create.mockResolvedValueOnce({ id: 'new-2' } as never)

      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')

      expect(result).toEqual({ result: 'claimed', articleId: 'new-2' })
      // The partial unique index rejects an insert while the old row still reads as
      // current, so the supersede-then-insert ORDER is not optional.
      expect(update.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[1])
      expect(update).toHaveBeenCalledWith({
        where: { id: 'current-1' },
        data: { supersededAt: expect.any(Date) },
      })
      expect(create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          predictionId: 'pred-1',
          version: 2,
          supersedesId: 'current-1',
          status: 'PENDING',
        }),
        select: { id: true },
      })
    })

    it('treats a legacy row with no contentHash at all as changed', async () => {
      create.mockImplementationOnce(() => {
        throw uniqueViolation()
      })
      findFirst.mockResolvedValue(currentRow({ contentHash: null }) as never)
      create.mockResolvedValueOnce({ id: 'new-3' } as never)

      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      expect(result).toEqual({ result: 'claimed', articleId: 'new-3' })
    })

    it('skips as skip_pending when a concurrent writer already versioned this URL first', async () => {
      create.mockImplementationOnce(() => {
        throw uniqueViolation()
      })
      findFirst.mockResolvedValue(currentRow({ contentHash: 'stale-hash' }) as never)
      create.mockImplementationOnce(() => {
        throw uniqueViolation()
      })

      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      // The concurrent writer's extraction may still be in flight (news-indexer#354) —
      // a caller cannot yet assume the evidence is captured, unlike skip_complete.
      expect(result).toEqual({ result: 'skip_pending', articleId: null })
    })

    it('re-throws a non-P2002 error from the versioning transaction', async () => {
      create.mockImplementationOnce(() => {
        throw uniqueViolation()
      })
      findFirst.mockResolvedValue(currentRow({ contentHash: 'stale-hash' }) as never)
      create.mockImplementationOnce(() => {
        throw new Error('connection reset')
      })

      await expect(claimArticleForExtraction('pred-1', article(), 'news-indexer')).rejects.toThrow(
        'connection reset',
      )
    })
  })

  describe('same content on the current row', () => {
    beforeEach(() => {
      create.mockRejectedValue(uniqueViolation())
      findFirst.mockResolvedValue(currentRow() as never)
    })

    it('claims when the conditional updateMany matches (a stale/backed-off row)', async () => {
      updateMany.mockResolvedValue({ count: 1 })
      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      expect(result).toEqual({ result: 'claimed', articleId: 'current-1' })
      expect(updateMany).toHaveBeenCalledTimes(1)
      const call = updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
      expect(call.where).toMatchObject({ id: 'current-1' })
      expect(call.data).toMatchObject({
        status: 'PENDING',
        statusReason: null,
        contentHash: hashArticleContent('Headline', 'A snippet'),
      })
    })

    it('skips as skip_complete when the conditional updateMany matches nothing and the row is COMPLETE', async () => {
      updateMany.mockResolvedValue({ count: 0 })
      findFirst.mockResolvedValue(currentRow({ status: 'COMPLETE' }) as never)
      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      // The row exists whether or not this re-claim matched — a caller resolving "the
      // pool row for this URL" gets it either way. A genuinely finished extraction
      // (news-indexer#354) — retrying can never learn anything new, unlike skip_pending.
      expect(result).toEqual({ result: 'skip_complete', articleId: 'current-1' })
    })

    it('skips as skip_pending when the conditional updateMany matches nothing and the row is still resolving (PENDING, not yet stale)', async () => {
      updateMany.mockResolvedValue({ count: 0 })
      findFirst.mockResolvedValue(currentRow({ status: 'PENDING' }) as never)
      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      expect(result).toEqual({ result: 'skip_pending', articleId: 'current-1' })
    })

    it('skips as skip_pending when the conditional updateMany matches nothing and the row is FAILED but still in backoff', async () => {
      updateMany.mockResolvedValue({ count: 0 })
      findFirst.mockResolvedValue(currentRow({ status: 'FAILED' }) as never)
      const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      expect(result).toEqual({ result: 'skip_pending', articleId: 'current-1' })
    })

    it("the updateMany's WHERE admits a backed-off non-terminal FAILED row and a stale PENDING claim, scoped to the current row's id", async () => {
      // The FAILED arm used to be a bare `{ status: 'FAILED' }` — no age gate, no reason
      // filter. news-indexer re-pushes the same set every poll cycle while its 5-minute
      // cooldown rolls, so an always-null article looped FAILED → PENDING → FAILED, burning
      // a full Oracul run (fetch + gatekeeper + extractor) each time (daatan#1232). The
      // schema's own comment, "eligible for retry once stale", was stricter than the code.
      updateMany.mockResolvedValue({ count: 1 })

      await claimArticleForExtraction('pred-1', article(), 'news-indexer')

      const call = updateMany.mock.calls[0][0] as { where: { id: string; OR: Record<string, unknown>[] } }
      expect(call.where.id).toBe('current-1')
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          {
            status: 'FAILED',
            statusReason: { notIn: TERMINAL_POOL_REASONS },
            updatedAt: { lt: expect.any(Date) },
          },
          { status: 'FAILED', statusReason: null, updatedAt: { lt: expect.any(Date) } },
          { status: 'PENDING', updatedAt: { lt: expect.any(Date) } },
        ]),
      )
      // And the ungated arm is GONE — its presence is the bug.
      expect(call.where.OR).not.toContainEqual({ status: 'FAILED' })
    })

    it('gates FAILED re-claims at 24h — the same budget the sweep spends on the same row', async () => {
      // Not an arbitrary number: pool-retry's RETRY_MIN_AGE_MS. Before this the organic path
      // was ~288× cheaper to trigger than the sweep it was silently competing with.
      updateMany.mockResolvedValue({ count: 1 })

      const before = Date.now()
      await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      const after = Date.now()

      const call = updateMany.mock.calls[0][0] as { where: { OR: Record<string, unknown>[] } }
      const failedArm = call.where.OR.find(
        (a) => a.status === 'FAILED' && a.statusReason === null,
      ) as { updatedAt: { lt: Date } }
      // The cutoff is `Date.now() - BACKOFF` evaluated INSIDE the call, so it is bounded by the
      // clock either side of the call and by nothing tighter. Asserting `>= before - BACKOFF` with
      // only `before` captured is a race that passes solely when both reads land in the same
      // millisecond — true on a fast runner, false on a real machine, so it failed 3/3 locally
      // while CI stayed green.
      const cutoff = failedArm.updatedAt.lt.getTime()
      const BACKOFF = 24 * 60 * 60 * 1000
      expect(cutoff).toBeGreaterThanOrEqual(before - BACKOFF)
      expect(cutoff).toBeLessThanOrEqual(after - BACKOFF)
    })

    it('lets a row that failed on the WIRE be re-claimed in a minute, not a day', async () => {
      // daatan#1261/#1262. The 24h backoff is priced against an article that always nulls
      // — it assumes the last run told us something ABOUT the article. A client timeout
      // tells us nothing about it: retro does not cancel, so the run finished and sits in
      // `forecast_cache` for an hour. Charging a wire event 24h of silence is what made
      // #1262 impossible by construction — a 1h cache against a 24h floor can never overlap.
      updateMany.mockResolvedValue({ count: 1 })

      const before = Date.now()
      await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      const after = Date.now()

      const call = updateMany.mock.calls[0][0] as { where: { OR: Record<string, unknown>[] } }
      const transportArm = call.where.OR.find(
        (a) =>
          a.status === 'FAILED' &&
          typeof a.statusReason === 'object' &&
          a.statusReason !== null &&
          'in' in (a.statusReason as object),
      ) as { statusReason: { in: string[] }; updatedAt: { lt: Date } } | undefined
      expect(transportArm).toBeDefined()

      // The set is the transport classes and ONLY them — a verdict class in here would
      // hand `oracle_abstain` the fast lane, which is the exact waste the 24h gate exists
      // to stop. Read off the real constant so widening it fails this test rather than
      // silently passing.
      expect(transportArm!.statusReason.in).toEqual([...TRANSPORT_NULL_REASONS])
      expect(transportArm!.statusReason.in).not.toContain('oracle_abstain')
      expect(transportArm!.statusReason.in).not.toContain('oracle_omitted')

      // Bounded both sides — the cutoff is `Date.now() - BACKOFF` read INSIDE the call, so
      // a one-sided assertion only passes when both clock reads land in the same
      // millisecond (the daatan#1257 flake).
      const cutoff = transportArm!.updatedAt.lt.getTime()
      const TRANSPORT_BACKOFF = 60 * 1000
      expect(cutoff).toBeGreaterThanOrEqual(before - TRANSPORT_BACKOFF)
      expect(cutoff).toBeLessThanOrEqual(after - TRANSPORT_BACKOFF)

      // And it really is the SHORT lane: strictly more recent than the 24h arm, i.e. it
      // widens the window rather than being a differently-worded copy of it.
      const failedArm = call.where.OR.find(
        (a) => a.status === 'FAILED' && a.statusReason === null,
      ) as { updatedAt: { lt: Date } }
      expect(cutoff).toBeGreaterThan(failedArm.updatedAt.lt.getTime())
    })

    it('re-ask delay clears the transport backoff, so our own recovery is never refused', async () => {
      // The failure mode daatan#1262 names: "the re-ask must not look like a fresh organic
      // push, or it will be refused as `unchanged` before it ever reaches retro". The gate
      // and the scheduler are two halves of one policy, and only their ORDER makes it work.
      updateMany.mockResolvedValue({ count: 1 })

      await claimArticleForExtraction('pred-1', article(), 'news-indexer')

      const call = updateMany.mock.calls[0][0] as { where: { OR: Record<string, unknown>[] } }
      const transportArm = call.where.OR.find(
        (a) => a.status === 'FAILED' && typeof a.statusReason === 'object' && a.statusReason !== null && 'in' in (a.statusReason as object),
      ) as { updatedAt: { lt: Date } }
      const backoffMs = Date.now() - transportArm.updatedAt.lt.getTime()
      expect(REASK_DELAY_MS).toBeGreaterThan(backoffMs)
      // …and still far inside retro's `cache_ttl_seconds = 3600`, which is the window the
      // recovered forecast actually lives in.
      expect(REASK_DELAY_MS).toBeLessThan(3600 * 1000)
    })

    it('never re-claims a terminal row — every FAILED arm is both age-gated and reason-aware', async () => {
      // "Terminal" used to be true of the SWEEP and false of every organic re-push:
      // pool-retry excluded oracle_omitted/oracle_null_final, the claim gate did not. Both
      // now agree. (A content change still revives a terminal row — that path is the
      // "content changed" branch above, and is deliberately unconditional on status.)
      updateMany.mockResolvedValue({ count: 1 })

      await claimArticleForExtraction('pred-1', article(), 'news-indexer')

      const call = updateMany.mock.calls[0][0] as { where: { OR: Record<string, unknown>[] } }
      const failedArms = call.where.OR.filter((a) => a.status === 'FAILED')
      for (const arm of failedArms) {
        expect(arm).toHaveProperty('updatedAt')
        expect('statusReason' in arm).toBe(true)
      }
    })

    it('stores the snippet on the re-claim path too, not just on first insert', async () => {
      updateMany.mockResolvedValue({ count: 1 })
      await claimArticleForExtraction('pred-1', article(), 'news-indexer')
      const call = updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(call.data.snippet).toBe('A snippet')
    })
  })

  it('stores the snippet so a later retry can re-send the text this attempt had', async () => {
    // Without it, pool-retry re-pushed title-only — strictly LESS text than the attempt
    // that already failed. For a Telegram row whose only content IS the snippet, that made
    // the second null near-deterministic and `oracle_null_final` a self-fulfilling
    // prophecy rather than a genuine re-test (daatan#1232).
    create.mockResolvedValue({ id: 'new-1' } as never)

    await claimArticleForExtraction('pred-1', article(), 'news-indexer')

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ snippet: 'A snippet' }) }),
    )
  })

  it('normalizes an empty snippet to null rather than storing an empty string', async () => {
    // So "we never had a snippet" and "the snippet was empty" read the same downstream —
    // pool-retry falls back to title-only on null, which is the pre-existing behaviour.
    create.mockResolvedValue({ id: 'new-1' } as never)

    await claimArticleForExtraction('pred-1', article({ snippet: '' }), 'news-indexer')

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ snippet: null }) }),
    )
  })

  it('re-throws non-P2002 errors from create rather than treating them as a lost race', async () => {
    create.mockRejectedValue(new Error('connection reset'))
    await expect(claimArticleForExtraction('pred-1', article(), 'news-indexer')).rejects.toThrow('connection reset')
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('publish-date admission gate (daatan#1651)', () => {
  beforeEach(() => vi.clearAllMocks())

  // Forecast created 2026-04-08; the four real outliers on the Netanyahu-PM pool were
  // 2021-06 / 2022-11 articles about the previous swearing-in and election.
  const claimCreatedAt = new Date('2026-04-08T10:00:00Z')
  const opts = { claimCreatedAt }

  it('publishedDaysBeforeClaim: whole days before creation; null when unknowable', () => {
    expect(publishedDaysBeforeClaim('2026-04-01', claimCreatedAt)).toBe(7)
    expect(publishedDaysBeforeClaim('2026-04-09', claimCreatedAt)).toBe(-1)
    expect(publishedDaysBeforeClaim('2021-06-11', claimCreatedAt)).toBeGreaterThan(STALE_PUBLISHED_REJECT_DAYS)
    expect(publishedDaysBeforeClaim(null, claimCreatedAt)).toBeNull()
    expect(publishedDaysBeforeClaim('not a date', claimCreatedAt)).toBeNull()
    expect(publishedDaysBeforeClaim('2021-06-11', null)).toBeNull()
    expect(publishedDaysBeforeClaim('2021-06-11', undefined)).toBeNull()
  })

  it('refuses an article published past the reject line: terminal excluded row, skip_stale, no PENDING claim', async () => {
    create.mockResolvedValue({ id: 'stale-1' } as never)

    const result = await claimArticleForExtraction('pred-1', article({ publishedAt: '2021-06-11' }), 'news-indexer', opts)

    expect(result).toEqual({ result: 'skip_stale', articleId: 'stale-1' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        predictionId: 'pred-1',
        url: 'https://reuters.com/a',
        publishedDate: '2021-06-11',
        status: 'FAILED',
        statusReason: STALE_PUBLISHED_REASON,
        excluded: true,
        origin: 'news-indexer',
      }),
      select: { id: true },
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('the refusal is terminal — the retry sweep must never re-drive it', () => {
    expect(TERMINAL_POOL_REASONS).toContain(STALE_PUBLISHED_REASON)
  })

  it('leaves an existing row untouched on conflict and points the outcome at it', async () => {
    // An admin may have un-excluded the row on purpose; the gate never re-excludes.
    create.mockRejectedValue(uniqueViolation())
    findFirst.mockResolvedValue({ id: 'existing-9' } as never)

    const result = await claimArticleForExtraction('pred-1', article({ publishedAt: '2021-06-11' }), 'analyze', opts)

    expect(result).toEqual({ result: 'skip_stale', articleId: 'existing-9' })
    expect(update).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('admits the 180–365-day band (log-only) and anything younger, as a normal claim', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)
    const warnBand = new Date(claimCreatedAt.getTime() - (STALE_PUBLISHED_WARN_DAYS + 10) * 86_400_000)
      .toISOString()
      .slice(0, 10)

    const inBand = await claimArticleForExtraction('pred-1', article({ publishedAt: warnBand }), 'news-indexer', opts)
    const fresh = await claimArticleForExtraction('pred-1', article({ publishedAt: '2026-04-01' }), 'news-indexer', opts)

    expect(inBand).toEqual({ result: 'claimed', articleId: 'new-1' })
    expect(fresh).toEqual({ result: 'claimed', articleId: 'new-1' })
    expect(create).toHaveBeenCalledTimes(2)
    for (const call of create.mock.calls) {
      expect(call[0].data).toEqual(expect.objectContaining({ status: 'PENDING' }))
      expect(call[0].data).not.toHaveProperty('excluded')
    }
  })

  it('does not apply the stale gate without a creation date', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)

    const noCreatedAt = await claimArticleForExtraction('pred-1', article({ publishedAt: '2021-06-11' }), 'news-indexer')
    const nullCreatedAt = await claimArticleForExtraction('pred-1', article({ publishedAt: '2021-06-11' }), 'news-indexer', {
      claimCreatedAt: null,
    })

    for (const r of [noCreatedAt, nullCreatedAt]) {
      expect(r).toEqual({ result: 'claimed', articleId: 'new-1' })
    }
    for (const call of create.mock.calls) {
      expect(call[0].data).toEqual(expect.objectContaining({ status: 'PENDING' }))
    }
  })

  // Was part of "never gates without a creation date or a parseable publish date" until
  // daatan#1679: an undated article used to be admitted on the reasoning that a missing date
  // says nothing about its age. Saying nothing is the problem — it skips every temporal
  // check rather than failing one — so it now fails closed.
  it('refuses an article with no parseable publish date, terminally (daatan#1679)', async () => {
    create.mockResolvedValue({ id: 'undated-1' } as never)

    const noDate = await claimArticleForExtraction('pred-1', article({ publishedAt: null }), 'news-indexer', opts)
    const junkDate = await claimArticleForExtraction('pred-1', article({ publishedAt: 'yesterday-ish' }), 'news-indexer', opts)

    for (const r of [noDate, junkDate]) {
      expect(r).toEqual({ result: 'skip_undated', articleId: 'undated-1' })
    }
    for (const call of create.mock.calls) {
      expect(call[0].data).toEqual(
        expect.objectContaining({ status: 'FAILED', statusReason: 'undated_published', excluded: true }),
      )
    }
  })

  // daatan#1679 item 2. The provenance is only useful if it survives on EVERY write path,
  // including the ones that refuse the article: a row excluded as undated or stale is exactly
  // the row a later audit wants to ask "where did that date come from?" about.
  it('persists the date provenance on the admitted path', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)

    await claimArticleForExtraction('pred-1', article({ publishedAtSource: 'feed' }), 'news-indexer')

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ publishedDate: '2026-07-01', publishedDateSource: 'feed' }),
      select: { id: true },
    })
  })

  it('persists the date provenance on the refused paths too', async () => {
    create.mockResolvedValue({ id: 'refused-1' } as never)

    await claimArticleForExtraction(
      'pred-1', article({ publishedAt: null, publishedAtSource: 'pushed' }), 'news-indexer', opts,
    )
    await claimArticleForExtraction(
      'pred-1', article({ publishedAt: '2019-01-01', publishedAtSource: 'page' }), 'news-indexer', opts,
    )

    expect(create.mock.calls[0][0].data).toEqual(expect.objectContaining({ publishedDateSource: 'pushed' }))
    expect(create.mock.calls[1][0].data).toEqual(expect.objectContaining({ publishedDateSource: 'page' }))
  })

  it('stores a null provenance rather than inventing one', async () => {
    create.mockResolvedValue({ id: 'new-2' } as never)

    await claimArticleForExtraction('pred-1', article({ publishedAtSource: null }), 'news-indexer')

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ publishedDateSource: null }),
      select: { id: true },
    })
  })

  it('refuses an undated article even when no creation date is supplied', async () => {
    create.mockResolvedValue({ id: 'undated-2' } as never)

    // Unlike the stale gate, this arm does not need claimCreatedAt: an article is undated
    // regardless of what it is being claimed against.
    const r = await claimArticleForExtraction('pred-1', article({ publishedAt: null }), 'news-indexer')

    expect(r).toEqual({ result: 'skip_undated', articleId: 'undated-2' })
  })

  it('keeps undated_published out of the retry path', () => {
    expect(TERMINAL_POOL_REASONS).toContain('undated_published')
  })

  it('claimArticlesForExtraction threads the options through to every article', async () => {
    create.mockResolvedValueOnce({ id: 'stale-1' } as never).mockResolvedValueOnce({ id: 'new-2' } as never)

    const results = await claimArticlesForExtraction(
      'pred-1',
      [article({ url: 'https://a.com/1', publishedAt: '2021-06-11' }), article({ url: 'https://b.com/2' })],
      'backfill',
      opts,
    )

    expect(results).toEqual([
      { result: 'skip_stale', articleId: 'stale-1' },
      { result: 'claimed', articleId: 'new-2' },
    ])
    // `articleIdsByUrl` still maps the refused row — callers only extract `claimed`
    // entries, so the id is harmless there and useful to the admin pool view.
    expect(articleIdsByUrl([article({ url: 'https://a.com/1' }), article({ url: 'https://b.com/2' })], results)).toEqual(
      new Map([
        ['https://a.com/1', 'stale-1'],
        ['https://b.com/2', 'new-2'],
      ]),
    )
  })
})

describe('claimArticlesForExtraction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('claims each article independently and returns per-article outcomes in order', async () => {
    create
      .mockResolvedValueOnce({ id: 'row-1' } as never) // first: new row, claimed
      .mockRejectedValueOnce(uniqueViolation()) // second: conflict, falls to updateMany
    findFirst.mockResolvedValueOnce({
      id: 'row-2',
      version: 1,
      contentHash: hashArticleContent('Headline', 'A snippet'),
      status: 'COMPLETE',
    } as never)
    updateMany.mockResolvedValueOnce({ count: 0 }) // second: same content, COMPLETE, nothing matched — skip_complete

    const results = await claimArticlesForExtraction(
      'pred-1',
      [article({ url: 'https://a.com/1' }), article({ url: 'https://b.com/2' })],
      'news-indexer',
    )

    expect(results).toEqual([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'skip_complete', articleId: 'row-2' },
    ])
  })
})

describe('articleIdsByUrl', () => {
  it('maps each article URL to its claimed row id', () => {
    const articles = [article({ url: 'https://a.com/1' }), article({ url: 'https://b.com/2' })]
    const outcomes = [
      { result: 'claimed' as const, articleId: 'row-1' },
      { result: 'skip_complete' as const, articleId: 'row-2' },
    ]
    expect(articleIdsByUrl(articles, outcomes)).toEqual(
      new Map([
        ['https://a.com/1', 'row-1'],
        ['https://b.com/2', 'row-2'],
      ]),
    )
  })

  it('omits a URL whose outcome lost the versioning race (articleId null)', () => {
    const articles = [article({ url: 'https://a.com/1' })]
    const outcomes = [{ result: 'skip_pending' as const, articleId: null }]
    expect(articleIdsByUrl(articles, outcomes)).toEqual(new Map())
  })
})

describe('failClaimedArticles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the given URLs FAILED with a truncated reason, scoped to still-PENDING rows', async () => {
    updateMany.mockResolvedValue({ count: 2 })

    await failClaimedArticles('pred-1', ['https://a.com/1', 'https://b.com/2'], 'extractor_error')

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        predictionId: 'pred-1',
        urlHash: { in: [hashUrl('https://a.com/1'), hashUrl('https://b.com/2')] },
        status: 'PENDING',
        supersededAt: null,
      },
      data: { status: 'FAILED', statusReason: 'extractor_error' },
    })
  })

  it('does nothing for an empty url list', async () => {
    await failClaimedArticles('pred-1', [], 'extractor_error')
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('never throws when the update itself fails', async () => {
    updateMany.mockRejectedValue(new Error('db down'))
    await expect(failClaimedArticles('pred-1', ['https://a.com/1'], 'extractor_error')).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})

describe('retireLegacyNullRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dry-run (apply=false) only counts the legacy oracle_null set and writes nothing', async () => {
    count.mockResolvedValue(124)

    const result = await retireLegacyNullRows(false)

    expect(result).toEqual({ matched: 124 })
    expect(count).toHaveBeenCalledWith({ where: { status: 'FAILED', statusReason: 'oracle_null' } })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('apply=true stamps the matched rows retired_legacy and returns the write count', async () => {
    updateMany.mockResolvedValue({ count: 124 })

    const result = await retireLegacyNullRows(true)

    expect(result).toEqual({ matched: 124 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: 'FAILED', statusReason: 'oracle_null' },
      data: { statusReason: 'retired_legacy' },
    })
    expect(count).not.toHaveBeenCalled()
  })
})
