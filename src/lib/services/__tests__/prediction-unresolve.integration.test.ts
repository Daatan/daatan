import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services/indexnow', () => ({ notifySearchEngines: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { resolvePrediction } from '@/lib/services/prediction-resolution'
import { unresolvePrediction } from '@/lib/services/prediction-unresolve'

let seq = 0
const unique = () => `${Date.now()}-${++seq}`

const USER_FIELDS = {
  rs: true, mu: true, sigma: true, volatility: true, eloRating: true, totalPredictions: true, correctPredictions: true,
} as const

async function makeUser(data: Record<string, unknown> = {}) {
  return prisma.user.create({ data: { email: `u-${unique()}@example.com`, name: 'U', ...data } })
}

async function makePrediction(authorId: string, data: Record<string, unknown> = {}) {
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${unique()}`,
      authorId,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `token-${unique()}`,
      ...data,
    } as never,
  })
}

async function commit(predictionId: string, userId: string, cuCommitted = 60, data: Record<string, unknown> = {}) {
  return prisma.commitment.create({
    data: { predictionId, userId, cuCommitted, rsSnapshot: 100, binaryChoice: true, ...data } as never,
  })
}

const resolve = (id: string, outcome: string, extra: Record<string, unknown> = {}) =>
  resolvePrediction(id, { outcome, resolvedById: admin.id, earlyResolutionAcknowledged: true, ...extra } as never)

/** Everything a resolution writes, for the before/after comparison. */
async function state(predictionId: string, userIds: string[]) {
  const prediction = await prisma.prediction.findUniqueOrThrow({
    where: { id: predictionId },
    select: {
      resolvedAt: true, resolvedById: true, resolutionOutcome: true, evidenceLinks: true, resolutionNote: true,
      resolutionOverrodePin: true, awaitingAiResolution: true, awaitingDismissedAt: true, awaitingDismissedConfidence: true,
      options: { select: { id: true, isCorrect: true }, orderBy: { id: 'asc' } },
      commitments: {
        select: {
          id: true, rsChange: true, brierScore: true, peerScore: true, aiScore: true, klDivergence: true, eloChange: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  })
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, ...USER_FIELDS }, orderBy: { id: 'asc' } })
  const tagRatings = await prisma.userTagRating.findMany({
    where: { userId: { in: userIds } },
    orderBy: [{ userId: 'asc' }, { tagId: 'asc' }],
  })
  const aiMemberScores = await prisma.aiMemberScore.count({ where: { predictionId } })
  const calibration = await prisma.calibrationRecord.count({ where: { predictionId } })
  return { prediction, users, tagRatings, aiMemberScores, calibration }
}

let admin: Awaited<ReturnType<typeof makeUser>>

beforeEach(async () => {
  admin = await makeUser({ role: 'ADMIN' })
})

describe('resolve then unresolve restores everything', () => {
  it('BINARY, including a user whose rs was clamped at 0', async () => {
    const clamped = await makeUser({ rs: 1, mu: 1600, sigma: 200, volatility: 0.07, eloRating: 1432.5, totalPredictions: 7, correctPredictions: 3 })
    const other = await makeUser({ rs: 120.25 })
    const p = await makePrediction(admin.id, { evidenceLinks: ['https://a.example'], awaitingAiResolution: true })
    await commit(p.id, clamped.id, 100) // certain YES; a 'wrong' outcome costs more than its 1 rs
    await commit(p.id, other.id, -40)
    const users = [clamped.id, other.id]
    const before = await state(p.id, users)

    await resolve(p.id, 'wrong')
    const during = await state(p.id, users)
    expect(during.users.find((u) => u.id === clamped.id)!.rs).toBe(0)
    expect(during.calibration).toBe(1)

    const out = await unresolvePrediction(p.id, admin.id, 'resolved too early')

    expect(out.prediction.status).toBe('ACTIVE')
    expect(await state(p.id, users)).toEqual(before)
  })

  it('MULTIPLE_CHOICE restores the option flags', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    const p = await makePrediction(admin.id, {
      outcomeType: 'MULTIPLE_CHOICE',
      options: { create: [{ text: 'A' }, { text: 'B', isCorrect: null }] },
    })
    const options = await prisma.predictionOption.findMany({ where: { predictionId: p.id }, orderBy: { text: 'asc' } })
    await commit(p.id, u1.id, 70, { optionId: options[0].id, binaryChoice: null })
    await commit(p.id, u2.id, 30, { optionId: options[1].id, binaryChoice: null })
    const before = await state(p.id, [u1.id, u2.id])

    await resolve(p.id, 'correct', { correctOptionId: options[0].id })
    expect((await prisma.predictionOption.findUniqueOrThrow({ where: { id: options[0].id } })).isCorrect).toBe(true)

    await unresolvePrediction(p.id, admin.id, 'wrong option')

    expect(await state(p.id, [u1.id, u2.id])).toEqual(before)
  })

  it('updates existing tag rows and deletes the ones the resolution created', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    const tagA = await prisma.tag.create({ data: { name: `A${unique()}`, slug: `a-${unique()}` } })
    const tagB = await prisma.tag.create({ data: { name: `B${unique()}`, slug: `b-${unique()}` } })
    await prisma.userTagRating.create({
      data: { userId: u1.id, tagId: tagA.id, elo: 1510.5, mu: 1490, sigma: 310, volatility: 0.061, updatedAt: new Date('2026-07-01T00:00:00Z') },
    })
    const p = await makePrediction(admin.id, { tags: { connect: [{ id: tagA.id }, { id: tagB.id }] } })
    await commit(p.id, u1.id, 60)
    await commit(p.id, u2.id, -60)
    const before = await state(p.id, [u1.id, u2.id])
    expect(before.tagRatings).toHaveLength(1)

    await resolve(p.id, 'correct')
    expect((await state(p.id, [u1.id, u2.id])).tagRatings).toHaveLength(4)

    await unresolvePrediction(p.id, admin.id, 'mistake')

    expect(await state(p.id, [u1.id, u2.id])).toEqual(before)
  })

  it('a past deadline reopens as PENDING', async () => {
    const u = await makeUser()
    const p = await makePrediction(admin.id, { resolveByDatetime: new Date('2026-01-01') })
    await commit(p.id, u.id)

    await resolve(p.id, 'correct')

    expect((await unresolvePrediction(p.id, admin.id, 'mistake')).prediction.status).toBe('PENDING')
  })

  it('records who reverted and why, and a re-resolution starts a new snapshot', async () => {
    const u = await makeUser()
    const p = await makePrediction(admin.id)
    await commit(p.id, u.id)
    await resolve(p.id, 'wrong')
    await unresolvePrediction(p.id, admin.id, 'premature')

    await resolve(p.id, 'correct')
    expect((await prisma.prediction.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('RESOLVED_CORRECT')

    const snapshots = await prisma.resolutionSnapshot.findMany({ where: { predictionId: p.id }, orderBy: { resolvedAt: 'asc' } })
    expect(snapshots.map((s) => [s.outcome, s.revertedById, s.revertReason])).toEqual([
      ['wrong', admin.id, 'premature'],
      ['correct', null, null],
    ])
    expect(snapshots[1].revertedAt).toBeNull()
  })
})

describe('later resolutions', () => {
  async function twoResolved(laterOutcome: string) {
    const u = await makeUser({ rs: 50 })
    const a = await makePrediction(admin.id)
    const b = await makePrediction(admin.id)
    await commit(a.id, u.id, 60)
    await commit(b.id, u.id, 20)
    const start = await state(a.id, [u.id])
    await resolve(a.id, 'correct')
    await new Promise((r) => setTimeout(r, 5))
    const afterA = await state(a.id, [u.id])
    await resolve(b.id, laterOutcome)
    return { u, a, b, start, afterA }
  }

  it('refuses while a later scored resolution touched the same users, and changes nothing', async () => {
    const { u, a, b } = await twoResolved('wrong')
    const before = await state(a.id, [u.id])

    await expect(unresolvePrediction(a.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(b.id) })

    expect(await state(a.id, [u.id])).toEqual(before)
    expect((await prisma.prediction.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('RESOLVED_CORRECT')
    expect((await prisma.resolutionSnapshot.findFirstOrThrow({ where: { predictionId: a.id } })).revertedAt).toBeNull()
  })

  it('reverting newest first unwinds both', async () => {
    const { u, a, b, start, afterA } = await twoResolved('wrong')

    await unresolvePrediction(b.id, admin.id, 'x')
    expect((await state(a.id, [u.id])).users).toEqual(afterA.users)

    await unresolvePrediction(a.id, admin.id, 'x')
    expect((await state(a.id, [u.id])).users).toEqual(start.users)
  })

  it('a later resolution of different users does not block', async () => {
    const u = await makeUser()
    const stranger = await makeUser()
    const a = await makePrediction(admin.id)
    const b = await makePrediction(admin.id)
    await commit(a.id, u.id)
    await commit(b.id, stranger.id)
    await resolve(a.id, 'correct')
    await resolve(b.id, 'correct')

    await expect(unresolvePrediction(a.id, admin.id, 'x')).resolves.toBeTruthy()
  })

  it('a later void does not block, and reverting it afterwards does not bring the first result back', async () => {
    const { u, a, b, start } = await twoResolved('void')

    await unresolvePrediction(a.id, admin.id, 'x')
    expect((await state(a.id, [u.id])).users).toEqual(start.users)

    // The void's snapshot recorded ratings that include a's result.
    await unresolvePrediction(b.id, admin.id, 'x')
    expect((await state(a.id, [u.id])).users).toEqual(start.users)
    expect((await prisma.prediction.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ACTIVE')
  })

  it('still sees a later resolution after "Forget History" detached its commitment', async () => {
    const { u, a, b } = await twoResolved('wrong')
    await prisma.commitment.updateMany({ where: { predictionId: b.id, userId: u.id }, data: { userId: null } })

    await expect(unresolvePrediction(a.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('refusals', () => {
  it('not found', async () => {
    await expect(unresolvePrediction('nope', admin.id, 'x')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('not resolved', async () => {
    const p = await makePrediction(admin.id)
    await expect(unresolvePrediction(p.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('resolved with no snapshot: before snapshots existed, or through the status override', async () => {
    const p = await makePrediction(admin.id, { status: 'RESOLVED_CORRECT', resolvedAt: new Date() })
    await expect(unresolvePrediction(p.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('a second revert', async () => {
    const u = await makeUser()
    const p = await makePrediction(admin.id)
    await commit(p.id, u.id)
    await resolve(p.id, 'correct')
    await unresolvePrediction(p.id, admin.id, 'x')

    await expect(unresolvePrediction(p.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('a detached commitment on the forecast itself', async () => {
    const u = await makeUser()
    const p = await makePrediction(admin.id)
    await commit(p.id, u.id)
    await resolve(p.id, 'correct')
    await prisma.commitment.updateMany({ where: { predictionId: p.id }, data: { userId: null } })

    await expect(unresolvePrediction(p.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 409 })
    expect((await prisma.prediction.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('RESOLVED_CORRECT')
  })
})
