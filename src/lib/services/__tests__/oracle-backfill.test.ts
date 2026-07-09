/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSearch, mockForecast, mockMeta, mockSave, mockMark, mockBuildQuery } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockForecast: vi.fn(),
  mockMeta: vi.fn(),
  mockSave: vi.fn(),
  mockMark: vi.fn(),
  mockBuildQuery: vi.fn(),
}))

vi.mock('@/lib/services/oracleSearch', () => ({ oracleSearch: (...a: unknown[]) => mockSearch(...a) }))
vi.mock('@/lib/llm/searchQuery', () => ({ buildSearchQuery: (...a: unknown[]) => mockBuildQuery(...a) }))
vi.mock('@/lib/services/oracle', () => ({
  getOracleForecast: (...a: unknown[]) => mockForecast(...a),
  DEFAULT_MAX_ARTICLES: 15,
}))
vi.mock('@/lib/services/forecast-sources', () => ({ getArticleMetaByUrl: (...a: unknown[]) => mockMeta(...a) }))
vi.mock('@/lib/services/context', () => ({
  saveOracleSnapshotOnly: (...a: unknown[]) => mockSave(...a),
  markOracleAttempted: (...a: unknown[]) => mockMark(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { refreshOracleSnapshot } from '../oracle-backfill'

const prediction = { id: 'p1', claimText: 'Will X happen?' }

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildQuery.mockResolvedValue('x query')
  mockMeta.mockResolvedValue(new Map())
})

describe('refreshOracleSnapshot', () => {
  it('marks attempted (so the backfill converges) when search finds no articles', async () => {
    mockSearch.mockResolvedValue([])
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'no-articles' })
    expect(mockMark).toHaveBeenCalledWith('p1', 'no-articles')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('marks attempted when the Oracle returns no usable forecast', async () => {
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({ forecast: null })
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'no-oracle' })
    expect(mockMark).toHaveBeenCalledWith('p1', 'no-oracle')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('persists the enriched snapshot on success (no attempted marker)', async () => {
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({
      forecast: {
        mean: 0.2, std: 0.1, ci_low: 0.0, ci_high: 0.4, articles_used: 1,
        sources: [{ source_id: 's1', source_name: 'BBC', url: 'https://a.com/1', stance: 0.2, certainty: 0.6, credibility_weight: 1, claims: ['c'] }],
      },
    })
    const r = await refreshOracleSnapshot(prediction)
    expect(r).toEqual({ status: 'ok', sources: 1 })
    expect(mockMark).not.toHaveBeenCalled()
    expect(mockSave).toHaveBeenCalledTimes(1)
    const saved = mockSave.mock.calls[0][0]
    expect(saved.predictionId).toBe('p1')
    expect(saved.oracleSnapshot.sources[0]).toMatchObject({ sourceName: 'BBC', stance: 0.2 })
  })

  it('forwards claimDirection/claimDeadline to getOracleForecast when present on the prediction', async () => {
    const deadline = new Date('2026-12-31T00:00:00.000Z')
    mockSearch.mockResolvedValue([{ url: 'https://a.com/1', title: 't', snippet: 's' }])
    mockForecast.mockResolvedValue({ forecast: null })
    await refreshOracleSnapshot({ ...prediction, claimDirection: 'SURVIVAL', claimDeadline: deadline })
    const [, opts] = mockForecast.mock.calls[0]
    expect(opts.claimDirection).toBe('SURVIVAL')
    expect(opts.claimDeadline).toBe(deadline)
  })
})
