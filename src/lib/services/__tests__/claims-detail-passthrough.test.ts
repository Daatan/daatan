/**
 * daatan#1645 — Oracle 1.5 Phase 1 item 1.4. Test only; no schema change, no migration.
 *
 * Phase 1 adds per-claim fields to retro's extraction (`reader_confidence`, `quantity`, `tone`,
 * `voice`, `report_kind`, `consensus_view`, and the `claim_strength` alias of `certainty`).
 * daatan is supposed to need nothing for any of them: `EvidencePoolArticle.claimsDetail` is
 * documented as retro's `ClaimDetail` wire shape stored VERBATIM.
 *
 * "Documented as" is not "verified as", and the cost of being wrong is asymmetric: a silent drop
 * here is only discovered in Phase 3, by which point the rows that lost their fields are
 * unrecoverable — `claimsDetail` has no backfill. So these tests pin the pass-through at every
 * layer that touches the column, using field names that do not exist in `OracleClaimDetail`
 * today. That is the whole point: the existing coverage in `evidence-pool.test.ts` writes KNOWN
 * keys, which a field-by-field mapper would happily preserve while dropping everything new.
 *
 * The four legs, matching the issue's checklist:
 *   1. write path      — `addArticlesToPool` stores unknown keys unchanged
 *   2. update path     — an omitting re-touch cannot null previously stored unknown keys (F11)
 *   3. read-back       — `toClaimsDetail` narrows without stripping
 *   4. re-send to retro — `recomputeFromPool` posts the unknown keys back intact
 */
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
    contextSnapshot: { findFirst: vi.fn() },
    prediction: { findUnique: vi.fn() },
  }
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
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { addArticlesToPool, recomputeFromPool } from '../evidence-pool'
import { toClaimsDetail } from '../oracle-snapshot'
import type { EnrichedOracleSource } from '../oracle-snapshot'

const findMany = vi.mocked(prisma.evidencePoolArticle.findMany)
const update = vi.mocked(prisma.evidencePoolArticle.update)
const mockGetOracleConfig = vi.mocked(getOracleConfig)
const mockOraculFetch = vi.mocked(oracleFetch)

/**
 * One claim carrying the full Phase 1 field set, none of which exists on `OracleClaimDetail`
 * today. `claim`/`stance`/`certainty` are the three `toClaimsDetail` actually validates, so they
 * are real; everything else is deliberately unmodelled. Cast at the boundary because that is
 * precisely the contract under test — retro sends more than daatan's type declares, and daatan
 * must not care.
 */
const SCHEMA_V3_CLAIM = {
  claim: 'Turnout will exceed 70%.',
  quote: 'Officials expect turnout above seventy percent.',
  stance: 0.6,
  certainty: 0.8,
  // --- Phase 1 additions: unknown to daatan's types, and that is the point ---
  claim_strength: 0.8,
  reader_confidence: { level: 0.7, trap: 'negation' },
  quantity: { value: 70, unit: 'percent', comparator: '>', as_of: '2026-10-28' },
  tone: 'alarm',
  voice: { kind: 'quoted_person', attributed_to: 'A. Minister' },
  report_kind: 'level',
  consensus_view: 'contested',
  claim_actor: { name: 'Central Elections Committee', type: 'institution' },
  claim_predicate: 'turnout exceeds threshold',
  claim_scope: { threshold: 0.7, deadline: '2026-10-28', arena: 'Knesset election' },
} as const

/** A second claim, so the array-shaped cases cannot pass on a single-element special case. */
const SECOND_CLAIM = {
  claim: 'A minister denied it.',
  stance: -0.4,
  certainty: 0.5,
  tone: 'neutral',
  voice: { kind: 'byline' },
} as const

const CLAIMS_V3 = [SCHEMA_V3_CLAIM, SECOND_CLAIM] as unknown as NonNullable<
  EnrichedOracleSource['claimsDetail']
>

const source = (over: Partial<EnrichedOracleSource> = {}): EnrichedOracleSource =>
  ({
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
  }) as EnrichedOracleSource

const idFor = (url: string, id = 'row-1'): Map<string, string> => new Map([[url, id]])

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
  claimsDetail: null,
  addedAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  ...over,
})

const AGGREGATE = {
  mean: 0.6,
  std: 0.25,
  ci_low: 0.3,
  ci_high: 0.9,
  articles_used: 1,
  settled: false,
  insufficient_data: false,
  reason: null,
}

describe('daatan#1645 — schema-v3 per-claim fields survive claims_detail storage verbatim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOracleConfig.mockReturnValue({ baseUrl: 'http://oracle', key: 'k' })
  })

  describe('1. write path — addArticlesToPool', () => {
    it('stores every Phase 1 per-claim key unchanged, including ones daatan has no type for', async () => {
      await addArticlesToPool(
        'pred-1',
        [source({ claimsDetail: CLAIMS_V3 })],
        'analyze',
        idFor('https://reuters.com/a'),
      )

      const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
      // `toEqual`, not `toMatchObject`: the assertion has to fail when a key is DROPPED, and
      // `toMatchObject` on the parent would still pass while the nested claim lost `quantity`.
      expect(call.data.claimsDetail).toEqual(CLAIMS_V3)
    })

    it('preserves nested objects inside a claim, not just scalar keys', async () => {
      // The Phase 1 fields that matter most are nested (`quantity`, `voice`, `reader_confidence`,
      // `claim_scope`). A mapper that copied known scalars would flatten exactly these to
      // undefined while leaving the top-level shape looking intact.
      await addArticlesToPool(
        'pred-1',
        [source({ claimsDetail: CLAIMS_V3 })],
        'analyze',
        idFor('https://reuters.com/a'),
      )

      const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
      const stored = (call.data.claimsDetail as Record<string, unknown>[])[0]
      expect(stored.quantity).toEqual({
        value: 70,
        unit: 'percent',
        comparator: '>',
        as_of: '2026-10-28',
      })
      expect(stored.voice).toEqual({ kind: 'quoted_person', attributed_to: 'A. Minister' })
      expect(stored.reader_confidence).toEqual({ level: 0.7, trap: 'negation' })
      expect(stored.claim_scope).toEqual({
        threshold: 0.7,
        deadline: '2026-10-28',
        arena: 'Knesset election',
      })
    })

    it('stores the same keys on the create path, not only the update path', async () => {
      // `addArticlesToPool` writes via `update` when the id map has an entry and `create`
      // otherwise. A pass-through proven on only one branch is not proven.
      const create = vi.mocked(prisma.evidencePoolArticle.create)
      await addArticlesToPool('pred-1', [source({ claimsDetail: CLAIMS_V3 })], 'analyze', new Map())

      const call = create.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(call.data.claimsDetail).toEqual(CLAIMS_V3)
    })
  })

  describe('2. update path — an omitting re-touch must not null what is stored (F11 / daatan#1237)', () => {
    it('skips the column entirely when the response carries no per-claim layer', async () => {
      // This is the daatan#1237 failure mode checked for the NEW keys specifically. Because
      // `claimsDetail` is one Json column, `undefined` protects every key inside it at once —
      // but that is a property of the current implementation, not a guarantee, and Phase 1 is
      // exactly when someone might "helpfully" start merging per-field. Pin it.
      await addArticlesToPool('pred-1', [source()], 'analyze', idFor('https://reuters.com/a'))

      const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(call.data.claimsDetail).toBeUndefined()
      expect('claimsDetail' in call.data).toBe(true) // present-but-undefined ⇒ Prisma skips it
    })

    it('does not partially overwrite: a later response with FEWER per-claim keys replaces wholesale', async () => {
      // The honest statement of today's contract. retro sending a reduced claim layer does not
      // merge into the stored one — it replaces it. That is correct for a verbatim column (the
      // newest extraction is the truth), but it means a retro build that silently stopped
      // emitting `quantity` would erase it here, which is worth stating out loud rather than
      // discovering in Phase 3.
      const reduced = [{ claim: 'Turnout will exceed 70%.', stance: 0.6, certainty: 0.8 }]
      await addArticlesToPool(
        'pred-1',
        [source({ claimsDetail: reduced as unknown as NonNullable<EnrichedOracleSource['claimsDetail']> })],
        'analyze',
        idFor('https://reuters.com/a'),
      )

      const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(call.data.claimsDetail).toEqual(reduced)
    })
  })

  describe('3. read-back — toClaimsDetail narrows without stripping', () => {
    it('returns the unknown Phase 1 keys intact', () => {
      const out = toClaimsDetail(structuredClone(CLAIMS_V3))
      expect(out).toEqual(CLAIMS_V3)
    })

    it('keeps nested Phase 1 objects intact through the narrowing', () => {
      const out = toClaimsDetail(structuredClone(CLAIMS_V3))
      const first = out?.[0] as unknown as Record<string, unknown>
      expect(first.quantity).toEqual({
        value: 70,
        unit: 'percent',
        comparator: '>',
        as_of: '2026-10-28',
      })
      expect(first.tone).toBe('alarm')
      expect(first.claim_strength).toBe(0.8)
    })

    it('still rejects a claim missing `certainty`, new keys or not', () => {
      // The existing contract this must not loosen: `recomputeFromPool` feeds this output
      // straight to /pool/aggregate, where one claim missing `certainty` 422s the WHOLE
      // request. A Phase 1 claim that carries `claim_strength` but drops `certainty` — a
      // plausible shape once the alias lands — must still degrade to null here.
      const aliasOnly = [{ ...SCHEMA_V3_CLAIM, certainty: undefined }]
      expect(toClaimsDetail(aliasOnly)).toBeNull()
    })
  })

  describe('4. re-send — recomputeFromPool posts the per-claim layer back to retro intact', () => {
    it('sends the unknown Phase 1 keys to /pool/aggregate unchanged', async () => {
      // The settlement match gate votes on this layer (daatan#1264). If the re-send stripped
      // the new fields, the gate would see a different claim layer than /forecast does — the
      // exact divergence Phase 3 would have to debug.
      findMany.mockResolvedValue([poolArticle({ claimsDetail: structuredClone(CLAIMS_V3) })] as never)
      mockOraculFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

      await recomputeFromPool('pred-1', null, null, null, null, 'Will turnout exceed 70%?')

      // `oracleFetch(cfg, path, init)` — the body is the THIRD argument.
      const [, , init] = mockOraculFetch.mock.calls[0] as [unknown, string, { body: string }]
      const body = JSON.parse(init.body) as {
        sources: { claims_detail: Record<string, unknown>[] | null }[]
      }
      expect(body.sources[0].claims_detail).toEqual(CLAIMS_V3)
    })
  })
})
