import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getArticleDotRows } from '@/lib/services/context'
import { buildArticleDots } from '@/lib/article-dots'

/**
 * `getArticleDotRows` (daatan#2300) against a real Postgres: the latest pool's readings plus each
 * URL's first appearance from the trigger-maintained `sources_delta` chain.
 */

let seq = 0
async function makePrediction() {
  seq++
  const user = await prisma.user.create({ data: { email: `ad${seq}@example.com`, name: `U${seq}`, rs: 100 } })
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${seq}`,
      authorId: user.id,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `ad-${seq}-${Date.now()}`,
      confidence: 50,
      claimArchetype: 'DIFFUSE',
    } as Parameters<typeof prisma.prediction.create>[0]['data'],
  })
}

const T = (day: number) => new Date(Date.UTC(2026, 10, day))

async function snap(predictionId: string, at: Date, oracleSnapshot: unknown, kind = 'evidence') {
  return prisma.contextSnapshot.create({
    data: {
      predictionId,
      summary: 's',
      sources: [],
      createdAt: at,
      kind,
      oracleSnapshot: oracleSnapshot === null ? Prisma.DbNull : (oracleSnapshot as Prisma.InputJsonValue),
    } as Parameters<typeof prisma.contextSnapshot.create>[0]['data'],
  })
}

const UTM = 'https://www.a.com/x?utm_source=t'

describe('getArticleDotRows (daatan#2300)', () => {
  it('reads the latest pool, dates each URL by its first snapshot, and keeps only voting entries', async () => {
    const p = await makePrediction()
    const other = await makePrediction()
    await snap(p.id, T(1), {
      mean: 50,
      sources: [
        { url: UTM, stance: 0.4, certainty: 0.8, title: 'A', sourceName: 'A News' },
        { url: 'https://gone.com/g', stance: 0.9, certainty: 1 },
      ],
    })
    // The latest pool, written before the T(2) snapshot: an out-of-order insert must not move
    // a.com/x's first sighting to T(3).
    await snap(p.id, T(3), {
      mean: 45,
      sources: [
        { url: 'https://a.com/x', stance: -0.6, certainty: 0.9, title: 'A2', outletName: 'A Outlet', claimsDetail: [{ big: 'blob' }] },
        { url: UTM, stance: 0.1, certainty: 0.3, title: null, sourceName: 'A News' },
        { url: 'https://b.com/y', stance: null, certainty: 0.5, title: 'B' },
        { url: 'https://c.com/z', stance: '0.3', certainty: 0.2 },
        { url: 'https://d.com/w', stance: 0.2, certainty: 0.2 },
      ],
    })
    await snap(p.id, T(2), {
      mean: 50,
      sources: [
        { url: UTM, stance: 0.4, certainty: 0.8, title: 'A', sourceName: 'A News' },
        { url: 'https://a.com/x', stance: 0.5, certainty: 0.5 },
        { url: 'https://gone.com/g', stance: 0.9, certainty: 1 },
      ],
    })
    await snap(p.id, T(4), null)
    await snap(p.id, T(5), { sources: [{ url: 'https://clock.com/q', stance: 0.9, certainty: 1 }] }, 'clock')
    await snap(other.id, T(6), { sources: [{ url: 'https://a.com/x', stance: 0.9, certainty: 1 }] })

    const rows = await getArticleDotRows(p.id)
    // gone.com left the pool, b.com has no stance and c.com's stance isn't a number: no vote.
    expect(rows).toEqual([
      { readAt: T(3), firstSeenAt: T(2), url: 'https://a.com/x', stance: -0.6, certainty: 0.9, title: 'A2', sourceName: null, outletName: 'A Outlet', poolSize: 3 },
      { readAt: T(3), firstSeenAt: T(1), url: UTM, stance: 0.1, certainty: 0.3, title: null, sourceName: 'A News', outletName: null, poolSize: 3 },
      { readAt: T(3), firstSeenAt: T(3), url: 'https://d.com/w', stance: 0.2, certainty: 0.2, title: null, sourceName: null, outletName: null, poolSize: 3 },
    ])

    // The two a.com URLs are one canonical article: first seen T(1), read as the later entry.
    const dots = buildArticleDots(rows)
    expect(dots.map((d) => [d.url, d.firstSeenAt, d.side, d.title, d.outletPath])).toEqual([
      [UTM, T(1).toISOString(), 'neutral', 'A2', '/sources/A%20Outlet'],
      ['https://d.com/w', T(3).toISOString(), 'yes', null, '/sources/d.com'],
    ])
  })

  it('caps the rows at the most certain ones, still in pool order, and reports the pool size', async () => {
    const p = await makePrediction()
    await snap(p.id, T(1), {
      sources: [
        // Malformed entries neither fail the query nor count toward the pool.
        'not an object',
        { url: 42, stance: 0.5, certainty: 1 },
        { url: 'https://e.com/1', stance: 0.5, certainty: 0.2 },
        { url: 'https://e.com/2', stance: 0.5, certainty: 0.9 },
        { url: 'https://e.com/3', stance: 0.5 },
        { url: 'https://e.com/4', stance: 0.5, certainty: 0.7 },
      ],
    })
    const rows = await getArticleDotRows(p.id, 2)
    expect(rows.map((r) => [r.url, r.poolSize])).toEqual([
      ['https://e.com/2', 4],
      ['https://e.com/4', 4],
    ])
  })

  // Updating sources_delta alone fires neither trigger (both are UPDATE OF oracle_snapshot).
  const breakDelta = {
    missing: (id: string) => prisma.$executeRaw`UPDATE context_snapshots SET sources_delta = NULL WHERE id = ${id}`,
    'based on another row': (id: string) =>
      prisma.$executeRaw`UPDATE context_snapshots SET sources_delta = '{"base":"elsewhere","upsert":[],"removed":[]}'::jsonb WHERE id = ${id}`,
  }
  for (const [how, apply] of Object.entries(breakDelta)) {
    it(`reads a snapshot from its own sources_summary when its delta is ${how}`, async () => {
      const p = await makePrediction()
      const e = (u: string) => ({ url: `https://e.com/${u}`, stance: 0.5, certainty: 0.5 })
      await snap(p.id, T(1), { sources: [e('x')] })
      const s2 = await snap(p.id, T(2), { sources: [e('x'), e('y')] })
      await snap(p.id, T(3), { sources: [e('x'), e('y'), e('z')] })
      await apply(s2.id)

      const rows = await getArticleDotRows(p.id)
      expect(rows.map((r) => [r.url, r.firstSeenAt])).toEqual([
        ['https://e.com/x', T(1)],
        ['https://e.com/y', T(2)],
        ['https://e.com/z', T(3)],
      ])
    })
  }

  it('returns nothing when the latest Oracul snapshot has no pool', async () => {
    const p = await makePrediction()
    expect(await getArticleDotRows(p.id)).toEqual([])
    await snap(p.id, T(1), { sources: [{ url: 'https://e.com/x', stance: 0.5, certainty: 0.5 }] })
    await snap(p.id, T(2), { mean: 50, sources: { not: 'an array' } })
    await snap(p.id, T(3), null)
    expect(await getArticleDotRows(p.id)).toEqual([])
  })
})
