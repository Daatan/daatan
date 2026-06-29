import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// withAuth → invoke handler directly with a fake admin user.
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (h: (req: NextRequest, u: unknown, c: unknown) => unknown) =>
    (req: NextRequest) => h(req, { id: 'a1', role: 'ADMIN' }, { params: {} }),
}))

vi.mock('@/env', () => ({ env: { DAATAN_EDITION: 'self_hosted' } }))

const SETTING_KEYS = {
  appName: 'app_name',
  appLogoUrl: 'app_logo_url',
  aboutTitle: 'app_about_title',
  aboutBody: 'app_about_body',
  openrouterApiKey: 'openrouter_api_key',
  openrouterModel: 'openrouter_model',
} as const

const store: Record<string, string> = {}
const setSetting = vi.fn(async (k: string, v: string) => {
  if (v.trim() === '') delete store[k]
  else store[k] = v.trim()
})
const rebuildLlmService = vi.fn()

vi.mock('@/lib/services/settings', () => ({
  SETTING_KEYS,
  loadSettings: vi.fn(async () => undefined),
  setSetting: (k: string, v: string) => setSetting(k, v),
  getCachedSetting: (k: string) => store[k],
  getOpenRouterKey: () => store[SETTING_KEYS.openrouterApiKey] || '',
}))
vi.mock('@/lib/llm', () => ({ rebuildLlmService: () => rebuildLlmService() }))

function put(body: unknown) {
  return new NextRequest('http://localhost/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  setSetting.mockClear()
  rebuildLlmService.mockClear()
})

describe('GET /api/admin/settings', () => {
  it('returns the key as a presence boolean, never the value', async () => {
    store[SETTING_KEYS.appName] = 'Acme'
    store[SETTING_KEYS.openrouterApiKey] = 'sk-or-supersecret'
    const { GET } = await import('@/app/api/admin/settings/route')
    const res = await GET(new NextRequest('http://localhost/api/admin/settings'), { params: Promise.resolve({}) } as never)
    const body = await res.json()

    expect(body.appName).toBe('Acme')
    expect(body.openrouterKeyConfigured).toBe(true)
    expect(JSON.stringify(body)).not.toContain('sk-or-supersecret')
    expect(body).not.toHaveProperty('openrouterKey')
  })
})

describe('PUT /api/admin/settings', () => {
  it('persists non-secret fields', async () => {
    const { PUT } = await import('@/app/api/admin/settings/route')
    await PUT(put({ appName: 'Acme', aboutTitle: 'Hi', aboutBody: '# Welcome' }), { params: Promise.resolve({}) } as never)
    expect(setSetting).toHaveBeenCalledWith(SETTING_KEYS.appName, 'Acme')
    expect(setSetting).toHaveBeenCalledWith(SETTING_KEYS.aboutTitle, 'Hi')
    expect(setSetting).toHaveBeenCalledWith(SETTING_KEYS.aboutBody, '# Welcome')
  })

  it('stores a supplied key and rebuilds the LLM service', async () => {
    const { PUT } = await import('@/app/api/admin/settings/route')
    await PUT(put({ openrouterKey: 'sk-or-new' }), { params: Promise.resolve({}) } as never)
    expect(setSetting).toHaveBeenCalledWith(SETTING_KEYS.openrouterApiKey, 'sk-or-new')
    expect(rebuildLlmService).toHaveBeenCalledOnce()
  })

  it('a blank/omitted key keeps the existing one (no write, no rebuild)', async () => {
    store[SETTING_KEYS.openrouterApiKey] = 'sk-or-existing'
    const { PUT } = await import('@/app/api/admin/settings/route')
    await PUT(put({ appName: 'Acme', openrouterKey: '   ' }), { params: Promise.resolve({}) } as never)
    expect(setSetting).not.toHaveBeenCalledWith(SETTING_KEYS.openrouterApiKey, expect.anything())
    expect(rebuildLlmService).not.toHaveBeenCalled()
    expect(store[SETTING_KEYS.openrouterApiKey]).toBe('sk-or-existing')
  })

  it('clears the key on the explicit flag and rebuilds', async () => {
    store[SETTING_KEYS.openrouterApiKey] = 'sk-or-existing'
    const { PUT } = await import('@/app/api/admin/settings/route')
    await PUT(put({ clearOpenrouterKey: true }), { params: Promise.resolve({}) } as never)
    expect(setSetting).toHaveBeenCalledWith(SETTING_KEYS.openrouterApiKey, '')
    expect(rebuildLlmService).toHaveBeenCalledOnce()
    expect(store[SETTING_KEYS.openrouterApiKey]).toBeUndefined()
  })
})
