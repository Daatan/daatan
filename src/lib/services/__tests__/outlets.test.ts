/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/env', () => ({
  env: {
    NEWS_INDEXER_URL: 'https://news-indexer.example.com',
    NEWS_INDEXER_API_KEY: 'test-key',
  },
}))

import { getPublicOutletDetail } from '../outlets'

describe('getPublicOutletDetail', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const samplePayload = {
    name: 'maariv',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Maariv',
    telegramChannel: 'maariv_news',
    links: [{ label: 'Homepage', url: 'https://maariv.co.il' }],
    notes: 'internal admin note — should never be returned',
    sourceConfig: { type: 'rss', locator: 'https://maariv.co.il/rss', language: 'he', enabled: true, domain: 'maariv.co.il' },
    impact: { matches: 10, forecastsAffected: 4, last30dMatches: 2, lastMatchedAt: '2026-07-01T00:00:00.000Z' },
    publications: [{ title: 'A', url: 'https://maariv.co.il/a', source: null, publishedAt: null, pushedAt: null, forecastId: 'p1', outcome: 'RESOLVED_CORRECT' }],
    linkedPeople: [{ id: 'person-1', canonicalName: 'Ben Caspit' }],
  }

  it('returns the outlet detail with notes stripped', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => samplePayload })
    const data = await getPublicOutletDetail('maariv')

    expect(data).not.toBeNull()
    expect(data).not.toHaveProperty('notes')
    expect(data?.name).toBe('maariv')
    expect(data?.wikipediaUrl).toBe(samplePayload.wikipediaUrl)
    expect(data?.impact).toEqual(samplePayload.impact)
    expect(data?.publications).toEqual(samplePayload.publications)
    expect(data?.linkedPeople).toEqual(samplePayload.linkedPeople)
    expect(fetchMock.mock.calls[0][0]).toBe('https://news-indexer.example.com/outlets/maariv')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { 'x-api-key': 'test-key' } })
  })

  it('URL-encodes the outlet name', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => samplePayload })
    await getPublicOutletDetail('some/outlet name')
    expect(fetchMock.mock.calls[0][0]).toBe('https://news-indexer.example.com/outlets/some%2Foutlet%20name')
  })

  it('returns null on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
    expect(await getPublicOutletDetail('unknown')).toBeNull()
  })

  it('returns null when the request throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(await getPublicOutletDetail('maariv')).toBeNull()
  })

  it('defaults array/object fields when the upstream omits them', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'x', impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null } }),
    })
    const data = await getPublicOutletDetail('x')
    expect(data?.links).toEqual([])
    expect(data?.publications).toEqual([])
    expect(data?.linkedPeople).toEqual([])
    expect(data?.sourceConfig).toBeNull()
  })
})
