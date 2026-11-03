/**
 * @jest-environment node
 *
 * Unit tests for the news-indexer resolution notifier. The /resolve fetch is
 * mocked with vi.stubGlobal('fetch', ...).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/env', () => ({
  env: {
    NEWS_INDEXER_URL: 'https://scrapper.daatan.com',
    NEWS_INDEXER_API_KEY: 'test-key',
  },
}))

import { notifyNewsIndexerResolution, notifyNewsIndexerUnresolve } from '../news-indexer'

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls.at(-1)!
  return JSON.parse((init as RequestInit).body as string)
}

describe('notifyNewsIndexerResolution', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('maps the outcome and includes both probabilities when supplied', () => {
    notifyNewsIndexerResolution('fc-1', 'correct', 0.62, 0.71)
    const body = lastBody(fetchMock)
    expect(body).toEqual({ forecastId: 'fc-1', outcome: 'YES', communityProbability: 0.62, aiProbability: 0.71 })
  })

  it('maps wrong → NO and void → ANNULLED', () => {
    notifyNewsIndexerResolution('fc-2', 'wrong')
    expect(lastBody(fetchMock).outcome).toBe('NO')
    notifyNewsIndexerResolution('fc-3', 'void')
    expect(lastBody(fetchMock).outcome).toBe('ANNULLED')
  })

  it('omits probabilities that are null/undefined (back-compatible body)', () => {
    notifyNewsIndexerResolution('fc-4', 'correct', null, undefined)
    const body = lastBody(fetchMock)
    expect(body).toEqual({ forecastId: 'fc-4', outcome: 'YES' })
    expect('communityProbability' in body).toBe(false)
    expect('aiProbability' in body).toBe(false)
  })

  it('can send only one probability', () => {
    notifyNewsIndexerResolution('fc-5', 'correct', undefined, 0.4)
    expect(lastBody(fetchMock)).toEqual({ forecastId: 'fc-5', outcome: 'YES', aiProbability: 0.4 })
  })
})

describe('notifyNewsIndexerUnresolve', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the forecast id to /unresolve', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reverted: 3, clampedSources: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    notifyNewsIndexerUnresolve('fc-1')

    expect(fetchMock.mock.calls[0][0]).toBe('https://scrapper.daatan.com/unresolve')
    expect(lastBody(fetchMock)).toEqual({ forecastId: 'fc-1' })
  })

  it.each([
    ['a refusal', () => Promise.resolve({ ok: false, status: 404 })],
    ['a network failure', () => Promise.reject(new Error('down'))],
  ])('%s does not throw', async (_name, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))

    expect(() => notifyNewsIndexerUnresolve('fc-1')).not.toThrow()
    await new Promise((r) => setTimeout(r))
  })
})
