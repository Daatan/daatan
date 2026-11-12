import { describe, it, expect } from 'vitest'
import { slimContextSnapshots, slimTimelineRows } from '../slim-context-snapshots'
import type { Snapshot } from '@/components/forecasts/ContextTimeline'

const fatSource = {
  sourceId: 's1',
  sourceName: 'example.com',
  url: 'https://example.com/a',
  stance: -0.4,
  certainty: 0.5,
  credibilityWeight: 1,
  claims: ['c'],
  settled: true,
  claimsDetail: [{ claim: 'c', event_actors: 'x', antecedent_text_en: 'y' }],
  eventActors: 'x',
}

const snap = (id: string): Snapshot =>
  ({
    id,
    summary: '',
    sources: [],
    createdAt: '2026-10-13T00:00:00.000Z',
    externalProbability: 47,
    oracleSnapshot: {
      mean: 47, std: 15, ciLow: 33, ciHigh: 60, articlesUsed: 1, settled: false,
      sources: [fatSource],
    },
  }) as unknown as Snapshot

describe('slimContextSnapshots', () => {
  it('drops shadow per-claim fields and keeps what the client reads', () => {
    const [latest] = slimContextSnapshots([snap('a')])
    expect(latest.oracleSnapshot).toMatchObject({ mean: 47, std: 15, ciLow: 33, ciHigh: 60, articlesUsed: 1, settled: false })
    expect(latest.oracleSnapshot!.sources).toHaveLength(1)
    const src = latest.oracleSnapshot!.sources[0] as Record<string, unknown>
    expect(src).toMatchObject({ sourceName: 'example.com', url: 'https://example.com/a', settled: true })
    expect(src).not.toHaveProperty('claimsDetail')
    expect(src).not.toHaveProperty('eventActors')
  })

  it('keeps sources only on the latest snapshot', () => {
    const out = slimContextSnapshots([snap('a'), snap('b')])
    expect(out[0].oracleSnapshot!.sources).toHaveLength(1)
    expect(out[1].oracleSnapshot!.sources).toEqual([])
    expect(out[1].oracleSnapshot!.mean).toBe(47)
  })

  it('leaves snapshots without an oracle payload untouched', () => {
    const plain = { id: 'p', summary: 's', sources: [], createdAt: 'x', oracleSnapshot: null } as Snapshot
    expect(slimContextSnapshots([plain])[0]).toBe(plain)
  })

  it('shrinks the serialized payload', () => {
    const big = snap('a')
    big.oracleSnapshot!.sources = Array.from({ length: 200 }, (_, i) => ({
      ...fatSource, sourceId: `s${i}`, claimsDetail: Array.from({ length: 3 }, () => ({ ...fatSource.claimsDetail[0], quote: 'q'.repeat(300) })),
    })) as never
    const before = JSON.stringify(big).length
    const after = JSON.stringify(slimContextSnapshots([big])[0]).length
    expect(after).toBeLessThan(before / 3)
  })
})

describe('slimTimelineRows (daatan#2152)', () => {
  const row = (id: string) => ({
    id,
    predictionId: 'p1',
    summary: 's',
    sources: [{ url: 'https://example.com/a', title: 't', source: 'example.com' }],
    externalProbability: 47,
    insufficientData: false,
    origin: 'news-indexer',
    articlesUsed: 1,
    createdAt: new Date('2026-10-13T00:00:00.000Z'),
    sourcesSummary: [{ sourceId: 's1', stance: -0.4 }],
    sourcesDelta: { base: null, upsert: [{ sourceId: 's1', stance: -0.4 }], removed: [] },
    oracleSnapshot: {
      mean: 47, std: 15, ciLow: 33, ciHigh: 60, articlesUsed: 1, settled: true,
      sources: [fatSource],
    } as unknown,
  })

  it('keeps whitelisted oracle sources on the newest row only and drops sourcesSummary/sourcesDelta', () => {
    const [latest, older] = slimTimelineRows([row('a'), row('b')])
    expect(latest).not.toHaveProperty('sourcesSummary')
    expect(older).not.toHaveProperty('sourcesSummary')
    expect(latest).not.toHaveProperty('sourcesDelta')
    expect(older).not.toHaveProperty('sourcesDelta')
    expect(latest.oracleSnapshot!.sources).toEqual([{
      sourceId: 's1', sourceName: 'example.com', url: 'https://example.com/a',
      stance: -0.4, certainty: 0.5, credibilityWeight: 1, claims: ['c'], settled: true,
    }])
    expect(older.oracleSnapshot).toEqual({ mean: 47, std: 15, ciLow: 33, ciHigh: 60, articlesUsed: 1, settled: true, sources: [] })
  })

  it('passes scalar columns and the cited-article sources through unchanged', () => {
    const r = row('a')
    const [out] = slimTimelineRows([r, row('b')])
    expect(out).toMatchObject({
      id: 'a', predictionId: 'p1', summary: 's', sources: r.sources, externalProbability: 47,
      insufficientData: false, origin: 'news-indexer', articlesUsed: 1, createdAt: r.createdAt,
    })
  })

  it('maps a missing oracle payload to null', () => {
    const [out] = slimTimelineRows([{ ...row('a'), oracleSnapshot: null }])
    expect(out.oracleSnapshot).toBeNull()
  })
})
