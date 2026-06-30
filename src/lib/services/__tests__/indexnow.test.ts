import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }))
vi.mock('@/env', () => ({ env: mockEnv }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { notifyIndexNow, notifyGoogle, notifySearchEngines, notifyIndexNowBulk } from '../indexnow'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(mockEnv)) delete mockEnv[k]
  global.fetch = fetchMock as never
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
})

describe('notifyIndexNow', () => {
  it('is a no-op without INDEXNOW_KEY', () => {
    notifyIndexNow('housing-index')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pings IndexNow with the forecast URL when configured', () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    notifyIndexNow('housing-index')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0]
    expect(endpoint).toBe('https://api.indexnow.org/indexnow')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      host: 'daatan.com',
      key: 'abc123',
      urlList: ['https://daatan.com/forecasts/housing-index'],
    })
  })
})

describe('notifyGoogle', () => {
  it('is a no-op unless both service-account vars are set', () => {
    notifyGoogle('housing-index')
    mockEnv.GOOGLE_INDEXING_CLIENT_EMAIL = 'sa@project.iam.gserviceaccount.com'
    notifyGoogle('housing-index') // private key still missing
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('notifyIndexNowBulk', () => {
  it('is a no-op (zero counts, no fetch) without INDEXNOW_KEY', async () => {
    const result = await notifyIndexNowBulk(['https://daatan.com/forecasts/a'])
    expect(result).toEqual({ submitted: 0, batches: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a no-op for an empty URL list', async () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    const result = await notifyIndexNowBulk([])
    expect(result).toEqual({ submitted: 0, batches: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits all URLs in one request and derives host + keyLocation from the first URL', async () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    const urls = ['https://daatan.com/', 'https://daatan.com/forecasts/btc-100k-2026']
    const result = await notifyIndexNowBulk(urls)

    expect(result).toEqual({ submitted: 2, batches: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0]
    expect(endpoint).toBe('https://api.indexnow.org/indexnow')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      host: 'daatan.com',
      key: 'abc123',
      keyLocation: 'https://daatan.com/abc123.txt',
      urlList: urls,
    })
  })

  it('splits more than 10,000 URLs across multiple batches', async () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    const urls = Array.from({ length: 10_001 }, (_, i) => `https://daatan.com/forecasts/f-${i}`)
    const result = await notifyIndexNowBulk(urls)

    expect(result).toEqual({ submitted: 10_001, batches: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).urlList).toHaveLength(10_000)
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).urlList).toHaveLength(1)
  })

  it('does not count a batch the endpoint rejected', async () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    const result = await notifyIndexNowBulk(['https://daatan.com/'])
    expect(result).toEqual({ submitted: 0, batches: 1 })
  })
})

describe('notifySearchEngines', () => {
  it('fans out to IndexNow when configured (Google no-op when unset)', () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    notifySearchEngines('housing-index')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.indexnow.org/indexnow')
  })
})
