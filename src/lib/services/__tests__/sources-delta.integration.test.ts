import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * The `sources_delta` mirror (daatan#2158): migration 20261112000000's triggers and the
 * backfill's per-prediction statement, against a real Postgres. The shape it must produce is
 * elections' `diffSources` (src/lib/elections/history-delta.ts).
 */

type Rec = { author: string | null; sourceName: string | null; stance: number | null; url: string | null; publishedAt: string | null }
type Delta = { base: string | null; upsert: Rec[]; removed: string[] } | null

const rec = (url: string | null, stance: number): Rec => ({ author: null, sourceName: 'x.com', stance, url, publishedAt: null })

let seq = 0
async function makePrediction() {
  seq++
  const user = await prisma.user.create({ data: { email: `sd${seq}@example.com`, name: `U${seq}`, rs: 100 } })
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${seq}`,
      authorId: user.id,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `sd-${seq}-${Date.now()}`,
      confidence: 50,
      claimArchetype: 'DIFFUSE',
    } as Parameters<typeof prisma.prediction.create>[0]['data'],
  })
}

const T = (min: number) => new Date(Date.UTC(2026, 10, 1, 0, min))

async function snap(predictionId: string, at: Date, sources: Rec[] | null, extra: Record<string, unknown> = {}) {
  return prisma.contextSnapshot.create({
    data: {
      predictionId,
      summary: 's',
      sources: [],
      createdAt: at,
      oracleSnapshot: sources === null ? Prisma.DbNull : { mean: 50, sources },
      ...extra,
    } as Parameters<typeof prisma.contextSnapshot.create>[0]['data'],
  })
}

const deltaOf = async (id: string) =>
  (await prisma.contextSnapshot.findUniqueOrThrow({ where: { id }, select: { sourcesDelta: true } })).sourcesDelta as Delta

describe('sources_delta trigger (daatan#2158)', () => {
  it('diffs each evidence snapshot against the previous one: base, upserts in order, removed urls', async () => {
    const p = await makePrediction()
    const s0 = await snap(p.id, T(0), [rec('a', 0.1), rec('b', 0.2)])
    const s1 = await snap(p.id, T(1), [rec('c', 0.3), rec('a', 0.1), rec('b', 0.5)])
    const s2 = await snap(p.id, T(2), [rec('b', 0.5)])

    expect(await deltaOf(s0.id)).toEqual({ base: null, upsert: [rec('a', 0.1), rec('b', 0.2)], removed: [] })
    expect(await deltaOf(s1.id)).toEqual({ base: s0.id, upsert: [rec('c', 0.3), rec('b', 0.5)], removed: [] })
    expect(await deltaOf(s2.id)).toEqual({ base: s1.id, upsert: [], removed: ['c', 'a'] })
  })

  it('skips clock rows and rows without an oracle snapshot when finding the previous row', async () => {
    const p = await makePrediction()
    const s0 = await snap(p.id, T(0), [rec('a', 0.1)])
    const clock = await snap(p.id, T(1), [rec('z', 0.9)], { kind: 'clock' })
    const blank = await snap(p.id, T(2), null)
    const s3 = await snap(p.id, T(3), [rec('a', 0.1)])

    expect(await deltaOf(clock.id)).toBeNull()
    expect(await deltaOf(blank.id)).toBeNull()
    expect(await deltaOf(s3.id)).toEqual({ base: s0.id, upsert: [], removed: [] })
  })

  it('stores no delta (a keyframe) when a url is missing or repeated', async () => {
    const p = await makePrediction()
    await snap(p.id, T(0), [rec('a', 0.1)])
    const noUrl = await snap(p.id, T(1), [rec('a', 0.1), rec(null, 0.2)])
    const dup = await snap(p.id, T(2), [rec('a', 0.1), rec('a', 0.3)])
    expect(await deltaOf(noUrl.id)).toBeNull()
    expect(await deltaOf(dup.id)).toBeNull()
  })

  it('re-diffs the successor when a row is inserted before it', async () => {
    const p = await makePrediction()
    const s0 = await snap(p.id, T(0), [rec('a', 0.1)])
    const s2 = await snap(p.id, T(2), [rec('a', 0.1), rec('c', 0.3)])
    const s1 = await snap(p.id, T(1), [rec('a', 0.1), rec('b', 0.2)])

    expect(await deltaOf(s1.id)).toEqual({ base: s0.id, upsert: [rec('b', 0.2)], removed: [] })
    expect(await deltaOf(s2.id)).toEqual({ base: s1.id, upsert: [rec('c', 0.3)], removed: ['b'] })
  })

  it('re-diffs the row and its successor when oracle_snapshot is rewritten in place', async () => {
    const p = await makePrediction()
    const s0 = await snap(p.id, T(0), [rec('a', 0.1)])
    const s1 = await snap(p.id, T(1), [rec('a', 0.1)])
    const s2 = await snap(p.id, T(2), [rec('a', 0.1)])

    await prisma.contextSnapshot.update({ where: { id: s1.id }, data: { oracleSnapshot: { mean: 50, sources: [rec('a', 0.7)] } } })

    expect(await deltaOf(s1.id)).toEqual({ base: s0.id, upsert: [rec('a', 0.7)], removed: [] })
    expect(await deltaOf(s2.id)).toEqual({ base: s1.id, upsert: [rec('a', 0.1)], removed: [] })
  })

  it('backfill statement reproduces what the trigger wrote', async () => {
    const p = await makePrediction()
    await snap(p.id, T(0), [rec('a', 0.1), rec('b', 0.2)])
    await snap(p.id, T(1), [rec('a', 0.4)])
    await snap(p.id, T(2), [rec('a', 0.4), rec('c', 0.3)])
    const byTrigger = await prisma.contextSnapshot.findMany({ where: { predictionId: p.id }, orderBy: { createdAt: 'asc' }, select: { id: true, sourcesDelta: true } })

    await prisma.$executeRaw`UPDATE "context_snapshots" SET sources_delta = NULL WHERE "predictionId" = ${p.id}`
    // The per-prediction statement of migration 20261112000001, for this one prediction.
    await prisma.$executeRaw`
      UPDATE "context_snapshots" c
         SET sources_delta = sources_delta_between(l.prev_id, l.prev_sources, COALESCE(c.sources_summary, '[]'::jsonb))
        FROM (
          SELECT id, lag(id) OVER w AS prev_id, lag(COALESCE(sources_summary, '[]'::jsonb)) OVER w AS prev_sources
            FROM "context_snapshots"
           WHERE "predictionId" = ${p.id} AND kind = 'evidence' AND oracle_snapshot IS NOT NULL
          WINDOW w AS (ORDER BY "createdAt", id)
        ) l
       WHERE c.id = l.id`
    const byBackfill = await prisma.contextSnapshot.findMany({ where: { predictionId: p.id }, orderBy: { createdAt: 'asc' }, select: { id: true, sourcesDelta: true } })

    expect(byBackfill).toEqual(byTrigger)
    expect(byTrigger.every((r) => r.sourcesDelta !== null)).toBe(true)
  })
})
