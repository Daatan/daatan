import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'

/**
 * The `prediction_reclassify_on_claim_edit` trigger (migration 20261123120000), against a
 * real Postgres. The classifier reads claimText and resolveByDatetime and runs once at
 * creation; the trigger clears classifier_version when either changes, which is what the
 * requote cron's self-heal pass picks up.
 */

const CLASSIFIED = {
  classifierVersion: 'test-v1',
  classifiedAt: new Date('2026-10-01T00:00:00Z'),
  claimDirection: 'ARRIVAL',
  claimArchetype: 'DIFFUSE',
  claimDeadline: new Date('2029-06-30T00:00:00Z'),
  tauLeadDays: 30,
} as const

let seq = 0
async function makeClassified() {
  seq++
  const user = await prisma.user.create({ data: { email: `rc${seq}@example.com`, name: `R${seq}`, rs: 100 } })
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${seq} happens by June 2029`,
      resolutionRules: 'Resolves YES if it happens.',
      authorId: user.id,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2029-07-01T00:00:00Z'),
      shareToken: `rc-${seq}-${Date.now()}`,
      confidence: 50,
      ...CLASSIFIED,
    } as Parameters<typeof prisma.prediction.create>[0]['data'],
  })
}

const classOf = (id: string) =>
  prisma.prediction.findUniqueOrThrow({
    where: { id },
    select: { classifierVersion: true, classifiedAt: true, claimDirection: true, claimArchetype: true, claimDeadline: true, tauLeadDays: true },
  })

describe('prediction_reclassify_on_claim_edit trigger', () => {
  it('re-queues on a claim change and keeps the previous classification in place', async () => {
    const p = await makeClassified()
    await prisma.prediction.update({ where: { id: p.id }, data: { claimText: 'It does NOT happen by June 2029' } })

    const c = await classOf(p.id)
    expect(c.classifierVersion).toBeNull()
    expect(c).toMatchObject({
      classifiedAt: CLASSIFIED.classifiedAt,
      claimDirection: 'ARRIVAL',
      claimArchetype: 'DIFFUSE',
      claimDeadline: CLASSIFIED.claimDeadline,
      tauLeadDays: 30,
    })
  })

  it('re-queues on a resolve-by change', async () => {
    const p = await makeClassified()
    await prisma.prediction.update({ where: { id: p.id }, data: { resolveByDatetime: new Date('2030-01-01T00:00:00Z') } })

    expect((await classOf(p.id)).classifierVersion).toBeNull()
  })

  it('re-queues on a hand-run UPDATE too', async () => {
    const p = await makeClassified()
    await prisma.$executeRaw`UPDATE predictions SET "claimText" = 'Rewritten by hand' WHERE id = ${p.id}`

    expect((await classOf(p.id)).classifierVersion).toBeNull()
  })

  it('leaves the stamp on a same-value write and on writes to other columns', async () => {
    const p = await makeClassified()
    await prisma.prediction.update({
      where: { id: p.id },
      data: { claimText: p.claimText, resolveByDatetime: p.resolveByDatetime },
    })
    await prisma.prediction.update({
      where: { id: p.id },
      data: { resolutionRules: 'Resolves NO if it happens.', detailsText: 'more', confidence: 61 },
    })

    expect((await classOf(p.id)).classifierVersion).toBe('test-v1')
  })

  it("does not re-fire on the classifier's own write", async () => {
    const p = await makeClassified()
    await prisma.prediction.update({ where: { id: p.id }, data: { claimText: 'Edited claim' } })
    // What classifyAndStoreTemporal writes: the classification columns only.
    await prisma.prediction.update({
      where: { id: p.id },
      data: { classifierVersion: 'test-v2', classifiedAt: new Date(), claimDirection: 'SURVIVAL', claimArchetype: 'DIFFUSE' },
    })

    expect((await classOf(p.id)).classifierVersion).toBe('test-v2')
  })
})
