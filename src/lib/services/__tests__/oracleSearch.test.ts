/**
 * @jest-environment node
 *
 * Verifies oracleSearch threads the call `meta` (source/user) into logOracleCall
 * and records the search engine + status for both success and failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/oracleClient', () => ({
  getOracleConfig: vi.fn(() => ({ baseUrl: 'http://oracle', key: 'k' })),
  oracleFetch: vi.fn(),
  logOracleCall: vi.fn(),
}))
vi.mock('@/lib/services/telegram', () => ({ notifyOraculSearchUnavailable: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { oracleSearch } from '../oracleSearch'
import { oracleFetch, logOracleCall } from '@/lib/services/oracleClient'

const mockFetch = vi.mocked(oracleFetch)
const mockLog = vi.mocked(logOracleCall)

beforeEach(() => vi.clearAllMocks())

describe('oracleSearch — usage logging', () => {
  it('logs an OK call with the source, engine (= provider) and result count', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: 'q',
        count: 2,
        provider: 'gdelt',
        provider_chain: ['ddg', 'gdelt'],
        results: [
          { title: 't', url: 'u', snippet: 's', source: 'BBC', published_date: '' },
          { title: 't2', url: 'u2', snippet: 's2', source: '', published_date: '' },
        ],
      }),
    } as never)

    await oracleSearch('q', 10, undefined, { source: 'research', userId: 'u1' })

    expect(mockLog).toHaveBeenCalledTimes(1)
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      callType: 'SEARCH',
      status: 'OK',
      meta: { source: 'research', userId: 'u1' },
      provider: 'gdelt',
      searchEngine: 'gdelt',
      resultCount: 2,
      httpStatus: 200,
    })
  })

  it('sends min_results only when a top-up floor is given (Daatan/retro#822)', async () => {
    const empty = { ok: true, status: 200, json: async () => ({ query: 'q', count: 0, provider: 'none', provider_chain: [], results: [] }) } as never
    mockFetch.mockResolvedValue(empty)

    await oracleSearch('q', 15, { dateFrom: new Date('2026-09-11T12:00:00Z'), minResults: 15 }, { source: 'context-update' })
    await oracleSearch('q', 15, { dateFrom: new Date('2026-09-11T12:00:00Z') }, { source: 'context-update' })

    expect(JSON.parse(mockFetch.mock.calls[0][2].body as string)).toEqual({
      query: 'q', limit: 15, date_from: '2026-09-11', min_results: 15,
    })
    expect(JSON.parse(mockFetch.mock.calls[1][2].body as string)).toEqual({
      query: 'q', limit: 15, date_from: '2026-09-11',
    })
  })

  it('logs an ERROR call (with http status) on a non-OK response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' } as never)

    await oracleSearch('q', 10, undefined, { source: 'bot-voting' })

    expect(mockLog.mock.calls[0][0]).toMatchObject({
      callType: 'SEARCH',
      status: 'ERROR',
      httpStatus: 503,
      meta: { source: 'bot-voting' },
    })
  })
})
