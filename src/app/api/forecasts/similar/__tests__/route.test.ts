import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-error', () => ({
  handleRouteError: (err: unknown, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 500 }),
}))

vi.mock('@/lib/services/forecast', () => ({
  getPredictionWithTags: vi.fn(),
  findSimilarForecasts: vi.fn(),
}))

vi.mock('@/lib/services/translation', () => ({
  getCachedClaimTranslations: vi.fn(),
}))

import { GET } from '../route'
import { getPredictionWithTags, findSimilarForecasts } from '@/lib/services/forecast'
import { getCachedClaimTranslations } from '@/lib/services/translation'

const makeRequest = (params: Record<string, string>) => {
  const url = new URL('http://localhost/api/forecasts/similar')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString())
}

const fakeSimilar = [
  {
    id: 'fc-1',
    slug: 'bitcoin-100k',
    claimText: 'Bitcoin will reach $100k',
    status: 'ACTIVE' as const,
    resolveByDatetime: new Date('2027-01-01'),
    author: { name: 'Alice', username: 'alice' },
    score: 0.92,
  },
]

describe('GET /api/forecasts/similar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no id or q supplied', async () => {
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.similar).toEqual([])
  })

  it('returns empty array when q is too short', async () => {
    const res = await GET(makeRequest({ q: 'hi' }))
    expect(res.status).toBe(200)
    expect((await res.json()).similar).toEqual([])
  })

  it('returns empty array when forecast id not found', async () => {
    vi.mocked(getPredictionWithTags).mockResolvedValue(null)
    const res = await GET(makeRequest({ id: 'missing' }))
    expect(res.status).toBe(200)
    expect((await res.json()).similar).toEqual([])
  })

  it('fetches claimText and tags from forecast when id supplied', async () => {
    vi.mocked(getPredictionWithTags).mockResolvedValue({
      claimText: 'Bitcoin will reach $100k',
      tags: [{ name: 'crypto' }, { name: 'finance' }],
    })
    vi.mocked(findSimilarForecasts).mockResolvedValue(fakeSimilar)

    const res = await GET(makeRequest({ id: 'fc-1' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(findSimilarForecasts)).toHaveBeenCalledWith({
      claimText: 'Bitcoin will reach $100k',
      tags: ['crypto', 'finance'],
      excludeId: 'fc-1',
      limit: 3,
    })
    expect((await res.json()).similar).toHaveLength(1)
  })

  it('uses q and tags query params directly', async () => {
    vi.mocked(findSimilarForecasts).mockResolvedValue(fakeSimilar)

    const res = await GET(makeRequest({ q: 'Will inflation drop below 3%?', tags: 'economics,usa' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(findSimilarForecasts)).toHaveBeenCalledWith(
      expect.objectContaining({ claimText: 'Will inflation drop below 3%?', tags: ['economics', 'usa'] })
    )
  })

  it('caps limit at 10', async () => {
    vi.mocked(findSimilarForecasts).mockResolvedValue([])
    await GET(makeRequest({ q: 'some long query here', limit: '50' }))
    expect(vi.mocked(findSimilarForecasts)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    )
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getPredictionWithTags).mockRejectedValue(new Error('DB down'))
    const res = await GET(makeRequest({ id: 'fc-1' }))
    expect(res.status).toBe(500)
  })

  describe('language overlay', () => {
    it('overlays cached translations and flags translated items', async () => {
      vi.mocked(findSimilarForecasts).mockResolvedValue([
        ...fakeSimilar,
        { ...fakeSimilar[0], id: 'fc-2', slug: 'no-translation', claimText: 'Untranslated claim' },
      ])
      vi.mocked(getCachedClaimTranslations).mockResolvedValue(
        new Map([['fc-1', 'Биткоин достигнет $100k']])
      )

      const res = await GET(makeRequest({ q: 'Bitcoin will reach $100k', language: 'ru' }))
      expect(res.status).toBe(200)
      expect(vi.mocked(getCachedClaimTranslations)).toHaveBeenCalledWith(['fc-1', 'fc-2'], 'ru')
      const { similar } = await res.json()
      expect(similar[0]).toMatchObject({ claimText: 'Биткоин достигнет $100k', translated: true })
      expect(similar[1]).toMatchObject({ claimText: 'Untranslated claim', translated: false })
    })

    it('skips the overlay for English', async () => {
      vi.mocked(findSimilarForecasts).mockResolvedValue(fakeSimilar)
      const res = await GET(makeRequest({ q: 'Bitcoin will reach $100k', language: 'en' }))
      expect(vi.mocked(getCachedClaimTranslations)).not.toHaveBeenCalled()
      const { similar } = await res.json()
      expect(similar[0].translated).toBeUndefined()
    })

    it('ignores unsupported language values', async () => {
      vi.mocked(findSimilarForecasts).mockResolvedValue(fakeSimilar)
      const res = await GET(makeRequest({ q: 'Bitcoin will reach $100k', language: 'xx' }))
      expect(res.status).toBe(200)
      expect(vi.mocked(getCachedClaimTranslations)).not.toHaveBeenCalled()
      expect((await res.json()).similar[0].claimText).toBe('Bitcoin will reach $100k')
    })
  })
})
