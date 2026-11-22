import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { textStalePoolRowWhere, TEXT_EDIT_GRACE_MS } from '@/lib/services/evidence-pool'
import { hashUrl } from '@/lib/utils/hash'

/**
 * The `prediction_text_changed_stamp` trigger (daatan#2274, migration 20261122120000) and the
 * stale-row filter that reads it, against a real Postgres. The trigger is the point: the claim
 * and rules have writers beyond `updateForecast`, including hand-run SQL.
 */

let seq = 0
async function makePrediction() {
  seq++
  const user = await prisma.user.create({ data: { email: `tc${seq}@example.com`, name: `U${seq}`, rs: 100 } })
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${seq}`,
      resolutionRules: 'Resolves YES if it happens.',
      authorId: user.id,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `tc-${seq}-${Date.now()}`,
      confidence: 50,
    } as Parameters<typeof prisma.prediction.create>[0]['data'],
  })
}

const stampOf = async (id: string) =>
  (await prisma.prediction.findUniqueOrThrow({ where: { id }, select: { textChangedAt: true } })).textChangedAt

async function poolRow(predictionId: string, n: number, updatedAt: Date) {
  const url = `https://example.com/tc/${predictionId}/${n}`
  const r = await prisma.evidencePoolArticle.create({
    data: {
      predictionId,
      url,
      urlHash: hashUrl(url),
      title: `Article ${n}`,
      origin: 'backfill',
      status: 'COMPLETE',
      excluded: false,
      stance: 0.5,
      certainty: 0.8,
      credibilityWeight: 1,
      relevanceScore: 0.8,
    } as Parameters<typeof prisma.evidencePoolArticle.create>[0]['data'],
  })
  // `@updatedAt` is client-side; the reading time has to be set behind Prisma's back.
  await prisma.$executeRaw`UPDATE evidence_pool_articles SET updated_at = ${updatedAt} WHERE id = ${r.id}`
  return r
}

describe('prediction_text_changed_stamp trigger (daatan#2274)', () => {
  it('is null on a new forecast and stays null when other columns change', async () => {
    const p = await makePrediction()
    await prisma.prediction.update({ where: { id: p.id }, data: { confidence: 61, detailsText: 'more' } })

    expect(await stampOf(p.id)).toBeNull()
  })

  it('stamps when the claim changes, in UTC', async () => {
    const p = await makePrediction()
    const before = Date.now()
    await prisma.prediction.update({ where: { id: p.id }, data: { claimText: 'Edited claim' } })

    const at = await stampOf(p.id)
    expect(at).not.toBeNull()
    expect(Math.abs(at!.getTime() - before)).toBeLessThan(60_000)
  })

  it('stamps when the rules change, including to null', async () => {
    const p = await makePrediction()
    await prisma.prediction.update({ where: { id: p.id }, data: { resolutionRules: null } })

    expect(await stampOf(p.id)).not.toBeNull()
  })

  it('does not stamp a write that sets the same text again', async () => {
    const p = await makePrediction()
    await prisma.prediction.update({ where: { id: p.id }, data: { claimText: p.claimText, resolutionRules: p.resolutionRules } })

    expect(await stampOf(p.id)).toBeNull()
  })

  it('stamps a hand-run UPDATE too', async () => {
    const p = await makePrediction()
    await prisma.$executeRaw`UPDATE predictions SET "resolutionRules" = 'Resolves NO if it happens.' WHERE id = ${p.id}`

    expect(await stampOf(p.id)).not.toBeNull()
  })

  it('moves forward on a second edit', async () => {
    const p = await makePrediction()
    // Setting the stamp alone does not fire the trigger (it watches only the two text columns).
    await prisma.$executeRaw`UPDATE predictions SET text_changed_at = '2026-01-01' WHERE id = ${p.id}`
    expect((await stampOf(p.id))!.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    await prisma.prediction.update({ where: { id: p.id }, data: { claimText: 'Second edit' } })

    expect((await stampOf(p.id))!.getTime()).toBeGreaterThan(new Date('2026-06-01').getTime())
  })
})

describe('textStalePoolRowWhere (daatan#2274)', () => {
  it('selects the usable rows read before the edit, plus the in-flight grace, and nothing later', async () => {
    const p = await makePrediction()
    await prisma.prediction.update({ where: { id: p.id }, data: { claimText: 'Edited claim' } })
    const at = (await stampOf(p.id))!
    const before = await poolRow(p.id, 1, new Date(at.getTime() - 24 * 60 * 60 * 1000))
    const inFlight = await poolRow(p.id, 2, new Date(at.getTime() + TEXT_EDIT_GRACE_MS / 2))
    await poolRow(p.id, 3, new Date(at.getTime() + 2 * TEXT_EDIT_GRACE_MS))
    const excluded = await poolRow(p.id, 4, new Date(at.getTime() - 60_000))
    await prisma.evidencePoolArticle.update({ where: { id: excluded.id }, data: { excluded: true } })

    const rows = await prisma.evidencePoolArticle.findMany({
      where: { predictionId: p.id, ...textStalePoolRowWhere(at) },
      select: { id: true },
      orderBy: { url: 'asc' },
    })

    expect(rows.map((r) => r.id)).toEqual([before.id, inFlight.id])
  })
})
