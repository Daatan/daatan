/**
 * @jest-environment node
 *
 * Unit tests for the shared Oracle HTTP client helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mutable env mock, hoisted so it exists before the vi.mock factory runs.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as { ORACLE_URL?: string; ORACLE_API_KEY?: string },
}))
vi.mock('@/env', () => ({ env: mockEnv }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oracleCallLog: { create: vi.fn(() => ({})), deleteMany: vi.fn(() => ({})) },
    $transaction: vi.fn(async () => [{ id: 'log-1' }, { count: 0 }]),
  },
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { getOracleBaseUrl, getOracleConfig, oracleFetch, logOracleCall } from '../oracleClient'
import { prisma } from '@/lib/prisma'

const mockCreate = vi.mocked(prisma.oracleCallLog.create)
const mockDeleteMany = vi.mocked(prisma.oracleCallLog.deleteMany)

beforeEach(() => {
  vi.clearAllMocks()
  mockEnv.ORACLE_URL = undefined
  mockEnv.ORACLE_API_KEY = undefined
})

describe('getOracleConfig', () => {
  it('returns null when URL or key is missing', () => {
    expect(getOracleConfig()).toBeNull()
    mockEnv.ORACLE_URL = 'https://oracle.daatan.com'
    expect(getOracleConfig()).toBeNull() // key still missing
    mockEnv.ORACLE_URL = undefined
    mockEnv.ORACLE_API_KEY = 'k'
    expect(getOracleConfig()).toBeNull() // url missing
  })

  it('returns normalized base URL + key, stripping a trailing slash', () => {
    mockEnv.ORACLE_URL = 'https://oracle.daatan.com/'
    mockEnv.ORACLE_API_KEY = 'secret'
    expect(getOracleConfig()).toEqual({ baseUrl: 'https://oracle.daatan.com', key: 'secret' })
  })
})

describe('getOracleBaseUrl', () => {
  it('returns null when URL is unset (no key required)', () => {
    expect(getOracleBaseUrl()).toBeNull()
  })

  it('returns the normalized URL without requiring a key', () => {
    mockEnv.ORACLE_URL = 'https://oracle.daatan.com/'
    expect(getOracleBaseUrl()).toBe('https://oracle.daatan.com')
  })
})

describe('oracleFetch', () => {
  it('builds the URL, adds the x-api-key header, merges caller headers and sets an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await oracleFetch(
      { baseUrl: 'https://oracle.daatan.com', key: 'secret' },
      '/forecast',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', timeoutMs: 1234 },
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oracle.daatan.com/forecast')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers['x-api-key']).toBe('secret')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect('timeoutMs' in init).toBe(false)

    vi.unstubAllGlobals()
  })
})

describe('logOracleCall', () => {
  it('writes a row with the call type, source, status, user and metrics', async () => {
    await logOracleCall({
      callType: 'FORECAST',
      status: 'OK',
      meta: { source: 'context-update', userId: 'u1', predictionId: 'p1' },
      durationMs: 321,
      httpStatus: 200,
      searchEngine: 'gdelt',
      query: 'Will X happen?',
      resultCount: 9,
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).toEqual({
      data: {
        callType: 'FORECAST',
        status: 'OK',
        source: 'context-update',
        userId: 'u1',
        predictionId: 'p1',
        durationMs: 321,
        httpStatus: 200,
        searchEngine: 'gdelt',
        provider: null,
        providerChain: [],
        query: 'Will X happen?',
        resultCount: 9,
        failureReason: null,
      },
      select: { id: true },
    })
    // Also prunes old rows.
    expect(mockDeleteMany).toHaveBeenCalledTimes(1)
  })

  it('defaults optional fields to null and userId to null when omitted', async () => {
    await logOracleCall({ callType: 'HEALTH', status: 'ERROR', meta: { source: 'health-cron' }, durationMs: 10 })
    const data = mockCreate.mock.calls[0][0].data
    expect(data.userId).toBeNull()
    expect(data.predictionId).toBeNull()
    expect(data.searchEngine).toBeNull()
    expect(data.provider).toBeNull()
    expect(data.query).toBeNull()
    expect(data.resultCount).toBeNull()
  })

  it('returns the created row id', async () => {
    const id = await logOracleCall({ callType: 'SEARCH', status: 'OK', meta: { source: 'research' }, durationMs: 5 })
    expect(id).toBe('log-1')
  })

  it('never throws and returns null when the write fails', async () => {
    mockCreate.mockImplementationOnce(() => { throw new Error('db down') })
    await expect(
      logOracleCall({ callType: 'SEARCH', status: 'OK', meta: { source: 'research' }, durationMs: 5 }),
    ).resolves.toBeNull()
  })
})
