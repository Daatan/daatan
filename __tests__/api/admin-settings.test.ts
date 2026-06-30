import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// withAuth → invoke handler directly with a fake admin user.
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (h: (req: NextRequest, u: unknown, c: unknown) => unknown) =>
    (req: NextRequest) => h(req, { id: 'a1', role: 'ADMIN' }, { params: {} }),
}))

// Mutable so a test can flip the edition; isSelfHosted() reads it at call time.
const mockEnv: Record<string, unknown> = { DAATAN_EDITION: 'self_hosted' }
vi.mock('@/env', () => ({ env: mockEnv }))

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
  mockEnv.DAATAN_EDITION = 'self_hosted'
  setSetting.mockClear()
  rebuildLlmService.mockClear()
})

describe('edition gating', () => {
  it('GET and PUT 404 on SaaS (the feature does not exist there)', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    const { GET, PUT } = await import('@/app/api/admin/settings/route')
    const getRes = await GET(new NextRequest('http://localhost/api/admin/settings'), { params: Promise.resolve({}) } as never)
    const putRes = await PUT(put({ appName: 'Acme' }), { params: Promise.resolve({}) } as never)
    expect(getRes.status).toBe(404)
    expect(putRes.status).toBe(404)
    expect(setSetting).not.toHaveBeenCalled()
  })
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

  it('returns the full editable field surface', async () => {
    store[SETTING_KEYS.appLogoUrl] = 'https://cdn/logo.png'
    store[SETTING_KEYS.aboutTitle] = 'About Acme'
    store[SETTING_KEYS.aboutBody] = '# Hi'
    store[SETTING_KEYS.openrouterModel] = 'openai/gpt-4o-mini'
    const { GET } = await import('@/app/api/admin/settings/route')
    const body = await (await GET(new NextRequest('http://localhost/api/admin/settings'), { params: Promise.resolve({}) } as never)).json()
    expect(body).toMatchObject({
      appLogoUrl: 'https://cdn/logo.png',
      aboutTitle: 'About Acme',
      aboutBody: '# Hi',
      openrouterModel: 'openai/gpt-4o-mini',
      openrouterKeyConfigured: false,
    })
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

  it('rebuilds on a model-only change (no key supplied)', async () => {
    const { PUT } = await import('@/app/api/admin/settings/route')
    await PUT(put({ openrouterModel: 'anthropic/claude-3.5' }), { params: Promise.resolve({}) } as never)
    expect(setSetting).toHaveBeenCalledWith(SETTING_KEYS.openrouterModel, 'anthropic/claude-3.5')
    expect(rebuildLlmService).toHaveBeenCalledOnce()
  })

  it('rejects an invalid payload with 400 and writes nothing', async () => {
    const { PUT } = await import('@/app/api/admin/settings/route')
    // appName over the 100-char cap + a disallowed logo scheme.
    const res = await PUT(put({ appName: 'x'.repeat(101), appLogoUrl: 'javascript:alert(1)' }), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(400)
    expect(setSetting).not.toHaveBeenCalled()
  })
})
