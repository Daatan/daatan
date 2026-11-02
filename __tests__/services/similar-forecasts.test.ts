/**
 * Unit tests for findSimilarForecasts — pgvector cosine similarity.
 *
 * Strategy: mock embedText (returns a fixed vector) and prisma.$queryRaw
 * (returns canned rows), then verify sorting and limit behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/services/embedding', () => ({
  embedText: vi.fn(),
  embedAndStoreForecast: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: {
  id?: string
  claimText?: string
  score?: number
  tagNames?: string[] | null
}) {
  return {
    id: overrides.id ?? 'forecast-1',
    slug: overrides.id ?? 'forecast-1',
    claimText: overrides.claimText ?? 'Will Bitcoin reach $100k?',
    status: 'ACTIVE',
    resolveByDatetime: new Date('2027-01-01'),
    authorName: 'Alice',
    authorUsername: 'alice',
    score: overrides.score ?? 0.9,
    tagNames: overrides.tagNames ?? null,
  }
}

const FAKE_EMBEDDING = new Array(768).fill(0.1)

// ── tests ─────────────────────────────────────────────────────────────────────

describe('findSimilarForecasts — vector search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when embedText returns null (no API key)', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { findSimilarForecasts } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(null)

    const results = await findSimilarForecasts({ claimText: 'Bitcoin 100k', tags: ['crypto'] })

    expect(results).toHaveLength(0)
  })

  it('returns results from the cosine query, shaped correctly', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { prisma } = await import('@/lib/prisma')
    const { findSimilarForecasts } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      makeRow({ id: 'a', score: 0.9 }),
    ])

    const results = await findSimilarForecasts({ claimText: 'Bitcoin 100k', tags: [] })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('a')
    expect(results[0].score).toBe(0.9)
    expect(results[0].author).toEqual({ name: 'Alice', username: 'alice' })
  })

  it('filters at 0.75 by default and at minScore when given (daatan#2083)', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { prisma } = await import('@/lib/prisma')
    const { findSimilarForecasts, DUPLICATE_WARNING_MIN_SCORE } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])

    await findSimilarForecasts({ claimText: 'Bitcoin 150k', tags: [] })
    await findSimilarForecasts({ claimText: 'Bitcoin 150k', tags: [], minScore: DUPLICATE_WARNING_MIN_SCORE })

    const [defaultSql, strictSql] = vi.mocked(prisma.$queryRaw).mock.calls.map(c => c[0] as unknown as { values: unknown[] })
    expect(defaultSql.values).toContain(0.75)
    expect(strictSql.values).toContain(DUPLICATE_WARNING_MIN_SCORE)
    expect(strictSql.values).not.toContain(0.75)
  })

  it('sorts by score descending', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { prisma } = await import('@/lib/prisma')
    const { findSimilarForecasts } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      makeRow({ id: 'low', score: 0.80 }),
      makeRow({ id: 'high', score: 0.95 }),
    ])

    const results = await findSimilarForecasts({ claimText: 'Bitcoin 100k', tags: [], limit: 2 })

    expect(results[0].id).toBe('high')
    expect(results[1].id).toBe('low')
  })

  it('uses shared tag count as tiebreaker on equal scores', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { prisma } = await import('@/lib/prisma')
    const { findSimilarForecasts } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      makeRow({ id: 'few-tags', score: 0.9, tagNames: ['crypto'] }),
      makeRow({ id: 'many-tags', score: 0.9, tagNames: ['crypto', 'finance', 'usa'] }),
    ])

    const results = await findSimilarForecasts({
      claimText: 'Bitcoin 100k',
      tags: ['crypto', 'finance'],
      limit: 2,
    })

    expect(results[0].id).toBe('many-tags')
  })

  it('respects the limit parameter', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { prisma } = await import('@/lib/prisma')
    const { findSimilarForecasts } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      makeRow({ id: 'a', score: 0.99 }),
      makeRow({ id: 'b', score: 0.95 }),
      makeRow({ id: 'c', score: 0.90 }),
      makeRow({ id: 'd', score: 0.85 }),
    ])

    const results = await findSimilarForecasts({ claimText: 'Bitcoin 100k', tags: [], limit: 2 })

    expect(results).toHaveLength(2)
  })

  it('returns empty array when the vector query returns no rows', async () => {
    const { embedText } = await import('@/lib/services/embedding')
    const { prisma } = await import('@/lib/prisma')
    const { findSimilarForecasts } = await import('@/lib/services/forecast')

    vi.mocked(embedText).mockResolvedValue(FAKE_EMBEDDING)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])

    const results = await findSimilarForecasts({ claimText: 'Bitcoin 100k', tags: [] })

    expect(results).toHaveLength(0)
  })
})
