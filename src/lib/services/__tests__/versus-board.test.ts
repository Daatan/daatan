import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/services/oracle', () => ({ getExpertResolutions: vi.fn() }))

import {
  buildVersusBoard, marketProbability, MARKET_MIN, PAIR_MIN, STRIP_MIN, type VersusForecast,
} from '../versus-board'
import { computeMarketScore } from '../ai-panel-score'

const f = (id: string, outcome: 0 | 1, people: number | null, oracul: number | null, market: number | null = null): VersusForecast =>
  ({ id, outcome, people, oracul, market })

/** n forecasts that resolved YES, people at 0.8 and the Oracul at 0.6, ids p0..p(n-1). */
const yesBatch = (n: number, over: Partial<VersusForecast> = {}) =>
  Array.from({ length: n }, (_, i) => ({ ...f(`p${i}`, 1, 0.8, 0.6), ...over }))

const experts = (ids: string[], p: number) => new Map(ids.map((id) => [id, p]))

describe('buildVersusBoard', () => {
  it('ranks the three groups on the forecasts all of them called', () => {
    const forecasts = [...yesBatch(STRIP_MIN), f('people-only', 0, 0.9, null)]
    const board = buildVersusBoard(forecasts, experts(forecasts.map((x) => x.id), 0.7))

    expect(board.strip?.n).toBe(STRIP_MIN)
    expect(board.strip?.rows.map((r) => r.group)).toEqual(['people', 'experts', 'oracul'])
    expect(board.strip?.rows[0].brier).toBeCloseTo(0.04)
    expect(board.coverage).toEqual({ people: STRIP_MIN + 1, oracul: STRIP_MIN, experts: STRIP_MIN + 1, market: 0 })
  })

  it('scores each pair on its own shared forecasts', () => {
    const forecasts = [...yesBatch(STRIP_MIN), f('people-only', 0, 0.9, null)]
    const board = buildVersusBoard(forecasts, experts(forecasts.map((x) => x.id), 0.7))
    const pe = board.pairs.find((p) => p.a === 'people' && p.b === 'experts')

    expect(pe).toMatchObject({ n: STRIP_MIN + 1, aCloser: STRIP_MIN, bCloser: 1, ties: 0 })
    expect(board.pairs.map((p) => `${p.a}-${p.b}`)).toEqual(['people-oracul', 'people-experts', 'oracul-experts'])
  })

  it('drops the strip below its minimum but keeps the pairs', () => {
    const board = buildVersusBoard(yesBatch(STRIP_MIN - 1), experts(yesBatch(STRIP_MIN - 1).map((x) => x.id), 0.7))
    expect(board.strip).toBeNull()
    expect(board.pairs).toHaveLength(3)
  })

  it('hides a pair with too few shared forecasts', () => {
    const forecasts = yesBatch(STRIP_MIN)
    const board = buildVersusBoard(forecasts, experts(['p0', 'p1'].slice(0, PAIR_MIN - 1), 0.7))
    expect(board.pairs.map((p) => `${p.a}-${p.b}`)).toEqual(['people-oracul'])
    expect(board.strip).toBeNull()
  })

  it('without experts there is no strip, only the people/Oracul pair', () => {
    const board = buildVersusBoard(yesBatch(STRIP_MIN), null)
    expect(board.strip).toBeNull()
    expect(board.pairs).toHaveLength(1)
    expect(board.coverage.experts).toBe(0)
  })

  it('counts equal distances as ties, float noise included', () => {
    const board = buildVersusBoard([...yesBatch(PAIR_MIN, { people: 0.3, oracul: 0.1 + 0.2 })], null)
    expect(board.pairs[0]).toMatchObject({ aCloser: 0, bCloser: 0, ties: PAIR_MIN })
  })

  it('keeps the market off until it covers enough forecasts', () => {
    const below = buildVersusBoard(yesBatch(STRIP_MIN, { market: 0.9 }).map((x, i) => (i < MARKET_MIN - 1 ? x : { ...x, market: null })), null)
    expect(below.coverage.market).toBe(MARKET_MIN - 1)
    expect(below.pairs.some((p) => p.b === 'market')).toBe(false)

    const at = buildVersusBoard(yesBatch(STRIP_MIN, { market: 0.9 }).map((x, i) => (i < MARKET_MIN ? x : { ...x, market: null })), null)
    expect(at.pairs.filter((p) => p.b === 'market').map((p) => p.a)).toEqual(['people', 'oracul'])
  })

  it('adds the market to the strip only when the common set stays large enough', () => {
    const ids = yesBatch(STRIP_MIN).map((x) => x.id)
    const partial = yesBatch(STRIP_MIN).map((x, i) => (i < MARKET_MIN ? { ...x, market: 0.9 } : x))
    expect(buildVersusBoard(partial, experts(ids, 0.7)).strip?.rows.map((r) => r.group)).toEqual(['people', 'experts', 'oracul'])

    const full = buildVersusBoard(yesBatch(STRIP_MIN, { market: 0.9 }), experts(ids, 0.7))
    expect(full.strip?.n).toBe(STRIP_MIN)
    expect(full.strip?.rows.map((r) => r.group)).toEqual(['market', 'people', 'experts', 'oracul'])
  })

  it('ignores expert probabilities for forecasts outside the eligible set', () => {
    const board = buildVersusBoard(yesBatch(PAIR_MIN), experts(['p0', 'p1', 'p2', 'p3', 'p4', 'gone'], 0.7))
    expect(board.coverage.experts).toBe(PAIR_MIN)
  })
})

describe('marketProbability', () => {
  const snap = [{ createdAt: new Date('2026-01-01'), probability: 30 }]
  const at = new Date('2026-01-02')

  it('recovers the price the market was scored on', () => {
    expect(marketProbability(computeMarketScore(snap, false, at, 1) as number, 1)).toBeCloseTo(0.3)
    expect(marketProbability(computeMarketScore(snap, false, at, 0) as number, 0)).toBeCloseTo(0.3)
  })

  it('stays in the forecast polarity for an inverted market', () => {
    expect(marketProbability(computeMarketScore(snap, true, at, 1) as number, 1)).toBeCloseTo(0.7)
    expect(marketProbability(computeMarketScore(snap, true, at, 0) as number, 0)).toBeCloseTo(0.7)
  })
})
