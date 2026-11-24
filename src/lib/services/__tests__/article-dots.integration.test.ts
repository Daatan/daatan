import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getArticleDotRows } from '@/lib/services/context'
import { buildArticleDots } from '@/lib/article-dots'

/**
 * `getArticleDotRows` (daatan#2300) against a real Postgres: the SQL projection of
 * `oracleSnapshot.sources[]` that feeds the expanded chart's article dots.
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

describe('getArticleDotRows (daatan#2300)', () => {
  it('flattens every evidence snapshot’s pool, oldest first and in pool order, skipping malformed entries', async () => {
    const p = await makePrediction()
    const other = await makePrediction()
    await snap(p.id, T(2), {
      mean: 55,
      sources: [{ url: 'https://a.com/x', stance: -0.6, certainty: 0.9, title: 'A2', outletName: 'A Outlet', claimsDetail: [{ big: 'blob' }] }],
    })
    await snap(p.id, T(1), {
      mean: 50,
      sources: [
        { url: 'https://www.a.com/x?utm_source=t', stance: 0.4, certainty: 0.8, title: 'A', sourceName: 'A News' },
        { url: 'https://b.com/y', stance: null, certainty: 0.5, title: 'B' },
        'not an object',
        { url: 'https://c.com/z', stance: '0.3', certainty: 0.2 },
      ],
    })
    await snap(p.id, T(3), { mean: 55, sources: { not: 'an array' } })
    await snap(p.id, T(4), null)
    await snap(p.id, T(5), { sources: [{ url: 'https://clock.com/q', stance: 0.9, certainty: 1 }] }, 'clock')
    await snap(other.id, T(1), { sources: [{ url: 'https://other.com/q', stance: 0.9, certainty: 1 }] })

    const rows = await getArticleDotRows(p.id)
    expect(rows).toEqual([
      { snapshotAt: T(1), url: 'https://www.a.com/x?utm_source=t', stance: 0.4, certainty: 0.8, title: 'A', sourceName: 'A News', outletName: null },
      { snapshotAt: T(1), url: 'https://b.com/y', stance: null, certainty: 0.5, title: 'B', sourceName: null, outletName: null },
      // A non-numeric stance reads as no stance rather than failing the query.
      { snapshotAt: T(1), url: 'https://c.com/z', stance: null, certainty: 0.2, title: null, sourceName: null, outletName: null },
      { snapshotAt: T(2), url: 'https://a.com/x', stance: -0.6, certainty: 0.9, title: 'A2', sourceName: null, outletName: 'A Outlet' },
    ])

    const dots = buildArticleDots(rows)
    expect(dots).toHaveLength(1)
    expect(dots[0]).toMatchObject({ firstSeenAt: T(1).toISOString(), side: 'no', outletPath: '/sources/A%20Outlet' })
  })

  it('returns nothing for a forecast with no Oracul snapshots', async () => {
    const p = await makePrediction()
    await snap(p.id, T(1), null)
    expect(await getArticleDotRows(p.id)).toEqual([])
  })
})
