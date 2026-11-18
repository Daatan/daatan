import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'

vi.mock('@/lib/services/oracle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/oracle')>('@/lib/services/oracle')
  return { ...actual, getAuthorShadowLeaderboard: vi.fn() }
})
import { getAuthorShadowLeaderboard } from '@/lib/services/oracle'
import { getSourceLeaderboard } from '@/lib/services/sourceLeaderboard'

const boardMock = vi.mocked(getAuthorShadowLeaderboard)
const shadowRow = (author: string, outlet_name: string) => ({
  id: `${author} — ${outlet_name}`, author, outlet_name, brier_score: 0.2, skill_mu: 25, skill_sigma: 8, skill_conservative: 0, predictions: 5, articles: 5,
})

let seq = 0
async function forecast(authorId: string, status: string, tagId?: string, isPublic = true) {
  seq++
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${seq}`,
      authorId,
      status,
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `side-${seq}-${Date.now()}`,
      confidence: 50,
      claimArchetype: 'DIFFUSE',
      isPublic,
      ...(tagId ? { tags: { connect: { id: tagId } } } : {}),
    } as Parameters<typeof prisma.prediction.create>[0]['data'],
  })
}

async function poolRow(predictionId: string, author: string, authorLean: number | null, overrides: Record<string, unknown> = {}) {
  seq++
  const url = `https://janeroe.blog/post-${seq}`
  return prisma.evidencePoolArticle.create({
    data: {
      predictionId, url, urlHash: hashUrl(url), title: `Post ${seq}`, source: 'janeroe.blog', outletName: 'janeroe.blog',
      author, authorLean, origin: 'backfill', status: 'COMPLETE', excluded: false,
      ...overrides,
    } as Parameters<typeof prisma.evidencePoolArticle.create>[0]['data'],
  })
}

describe('"takes a side" counts against the real pool (#2231)', () => {
  beforeEach(() => {
    boardMock.mockReset()
    boardMock.mockResolvedValue({ count: 2, authors: [shadowRow('Jane Roe', 'janeroe.blog'), shadowRow('John Doe', 'janeroe.blog')] })
  })

  it('counts public forecasts only (isPublic, status, retro), credits joint bylines, honours the tag', async () => {
    const user = await prisma.user.create({ data: { email: 'side@example.com', name: 'Side' } })
    const tag = await prisma.tag.create({ data: { name: 'Economy', slug: 'economy' } })

    const active = await forecast(user.id, 'ACTIVE', tag.id)
    const voided = await forecast(user.id, 'VOID')
    const resolved = await forecast(user.id, 'RESOLVED_WRONG')
    const draft = await forecast(user.id, 'DRAFT')
    const pending = await forecast(user.id, 'PENDING_APPROVAL')
    const unlisted = await forecast(user.id, 'ACTIVE', undefined, false)
    const retro = await forecast(user.id, 'RESOLVED_CORRECT')
    await prisma.retroSimulation.create({
      data: { predictionId: retro.id, asOf: new Date('2026-11-01T00:00:00Z'), cutoffAt: new Date('2026-11-10T00:00:00Z'), outcome: 'correct' },
    })

    await poolRow(active.id, 'Jane Roe', 0.7)
    await poolRow(voided.id, 'Jane Roe', 0)
    await poolRow(resolved.id, 'Jane Roe; John Doe', -0.5)
    for (const hidden of [draft, pending, unlisted, retro]) await poolRow(hidden.id, 'Jane Roe', 0.9)
    // Not current, excluded or not COMPLETE: none of these count either.
    await poolRow(voided.id, 'Jane Roe', 0.8, { supersededAt: new Date(), url: 'https://janeroe.blog/old', urlHash: hashUrl('https://janeroe.blog/old') })
    await poolRow(voided.id, 'Jane Roe', 0.8, { excluded: true })
    await poolRow(voided.id, 'Jane Roe', 0.8, { status: 'FAILED' })

    const all = await getSourceLeaderboard('authors', 'skillConservative', 0, undefined, { sideCounts: true })
    const by = Object.fromEntries(all.authorRows.map(r => [r.author, [r.sideTaken, r.sideTotal]]))
    expect(by).toEqual({ 'Jane Roe': [2, 3], 'John Doe': [1, 1] })

    const tagged = await getSourceLeaderboard('authors', 'skillConservative', 0, 'economy', { sideCounts: true })
    const byTag = Object.fromEntries(tagged.authorRows.map(r => [r.author, [r.sideTaken, r.sideTotal]]))
    expect(byTag).toEqual({ 'Jane Roe': [1, 1], 'John Doe': [null, null] })
  })
})
