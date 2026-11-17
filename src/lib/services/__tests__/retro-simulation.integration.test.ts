import { describe, expect, it, vi } from 'vitest'

const VECTOR = Array.from({ length: 768 }, (_, i) => (i % 7) / 7)

vi.mock('@/lib/services/indexnow', () => ({ notifySearchEngines: vi.fn() }))
vi.mock('@/lib/services/embedding', () => ({
  embedText: vi.fn(async () => VECTOR),
  embedAndStoreForecast: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { approveRetroSimulation } from '@/lib/services/retro-simulation'
import { unresolvePrediction } from '@/lib/services/prediction-unresolve'
import { findSimilarForecasts } from '@/lib/services/forecast'

let seq = 0
const unique = () => `${Date.now()}-${++seq}`

async function makeUser(data: Record<string, unknown> = {}) {
  return prisma.user.create({ data: { email: `u-${unique()}@example.com`, name: 'U', ...data } })
}

async function makePrediction(authorId: string, data: Record<string, unknown> = {}) {
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${unique()}`,
      authorId,
      status: 'PENDING_APPROVAL',
      isPublic: false,
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2026-11-30'),
      shareToken: `token-${unique()}`,
      ...data,
    } as never,
  })
}

async function makeRetro(authorId: string, outcome = 'correct') {
  const p = await makePrediction(authorId)
  await prisma.retroSimulation.create({
    data: {
      predictionId: p.id,
      asOf: new Date('2026-11-08T00:00:00Z'),
      cutoffAt: new Date('2026-11-15T09:00:00Z'),
      outcome,
    },
  })
  return p
}

const setEmbedding = (id: string) =>
  prisma.$executeRawUnsafe(`UPDATE predictions SET embedding = '[${VECTOR.join(',')}]'::vector WHERE id = $1`, id)

describe('retro simulations (daatan#2217)', () => {
  it('approval resolves to the recorded outcome without publishing, staking or calibrating', async () => {
    const bot = await makeUser({ isBot: true })
    const approver = await makeUser({ role: 'ADMIN' })
    const p = await makeRetro(bot.id, 'wrong')

    const result = await approveRetroSimulation(p.id, approver.id)
    expect(result).toMatchObject({ ok: true, prediction: { id: p.id, status: 'RESOLVED_WRONG' } })

    const after = await prisma.prediction.findUniqueOrThrow({
      where: { id: p.id },
      select: {
        status: true, isPublic: true, resolutionOutcome: true, resolvedById: true, resolvedAt: true, publishedAt: true,
        _count: { select: { commitments: true, resolutionSnapshots: true } },
        calibrationRecord: { select: { id: true } },
      },
    })
    expect(after).toMatchObject({
      status: 'RESOLVED_WRONG',
      isPublic: false,
      resolutionOutcome: 'wrong',
      resolvedById: approver.id,
      publishedAt: null,
      _count: { commitments: 0, resolutionSnapshots: 0 },
      calibrationRecord: null,
    })
    expect(after.resolvedAt).toBeInstanceOf(Date)

    // A second approve finds it no longer pending.
    expect(await approveRetroSimulation(p.id, approver.id)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses to unresolve one back to a live status', async () => {
    const bot = await makeUser({ isBot: true })
    const approver = await makeUser({ role: 'ADMIN' })
    const p = await makeRetro(bot.id)
    await approveRetroSimulation(p.id, approver.id)

    await expect(unresolvePrediction(p.id, approver.id, 'test')).rejects.toMatchObject({ statusCode: 409 })
    expect((await prisma.prediction.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('RESOLVED_CORRECT')
  })

  it('is never offered as a similar forecast', async () => {
    const author = await makeUser()
    const bot = await makeUser({ isBot: true })
    const live = await makePrediction(author.id, { status: 'ACTIVE', isPublic: true })
    const retro = await makeRetro(bot.id)
    await setEmbedding(live.id)
    await setEmbedding(retro.id)

    const ids = (await findSimilarForecasts({ claimText: 'anything', tags: [], limit: 50 })).map((s) => s.id)
    expect(ids).toContain(live.id)
    expect(ids).not.toContain(retro.id)
  })
})
