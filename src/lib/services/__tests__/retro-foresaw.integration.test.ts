import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getForesawEvent, listForesawEvents } from '@/lib/services/retro-foresaw'

let seq = 0
const unique = () => `${Date.now()}-${++seq}`

const EVIDENCE = {
  search: { q: 'q' },
  sent: [{ url: 'https://a.com/1', title: 'A', source: 'a.com', publishedAt: '2026-11-01T00:00:00Z', similarity: 0.5, hadText: true }],
  oracul: { mean: 0.4, articlesUsed: 1, logId: null, sources: [{ url: 'https://a.com/1', source: 'a.com', stance: 0.4, certainty: 0.8, claims: [] }] },
  reports: [],
}

async function makeForecast(authorId: string, status: string, retro: boolean) {
  const slug = `foresaw-${unique()}`
  const p = await prisma.prediction.create({
    data: {
      claimText: `Claim ${slug}`,
      slug,
      authorId,
      status,
      isPublic: !retro,
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2026-11-30'),
      shareToken: `token-${unique()}`,
    } as never,
  })
  if (retro) {
    await prisma.retroSimulation.create({
      data: {
        predictionId: p.id,
        asOf: new Date('2026-11-08T00:00:00Z'),
        cutoffAt: new Date('2026-11-15T09:00:00Z'),
        outcome: 'correct',
        eventText: `Event ${slug}`,
        eventDate: new Date('2026-11-15T00:00:00Z'),
        oraculProbability: 0.7,
        articlesUsed: 1,
        evidence: EVIDENCE,
      },
    })
  }
  return slug
}

describe('"Who foresaw X?" visibility gate (daatan#2217 PR 3)', () => {
  it('shows only approved retro simulations: pending, rejected and non-retro forecasts never match', async () => {
    const bot = await prisma.user.create({ data: { email: `b-${unique()}@example.com`, name: 'B', isBot: true } })
    const approved = await makeForecast(bot.id, 'RESOLVED_CORRECT', true)
    const pending = await makeForecast(bot.id, 'PENDING_APPROVAL', true)
    const rejected = await makeForecast(bot.id, 'VOID', true)
    const ordinary = await makeForecast(bot.id, 'RESOLVED_CORRECT', false)

    expect((await getForesawEvent(approved))?.articles).toHaveLength(1)
    for (const slug of [pending, rejected, ordinary]) expect(await getForesawEvent(slug)).toBeNull()

    const listed = (await listForesawEvents()).map((e) => e.slug)
    expect(listed).toContain(approved)
    for (const slug of [pending, rejected, ordinary]) expect(listed).not.toContain(slug)
  })
})
