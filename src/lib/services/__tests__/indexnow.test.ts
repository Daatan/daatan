import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }))
vi.mock('@/env', () => ({ env: mockEnv }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { notifyIndexNow, notifyGoogle, notifySearchEngines } from '../indexnow'

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

describe('notifySearchEngines', () => {
  it('fans out to IndexNow when configured (Google no-op when unset)', () => {
    mockEnv.INDEXNOW_KEY = 'abc123'
    notifySearchEngines('housing-index')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.indexnow.org/indexnow')
  })
})
