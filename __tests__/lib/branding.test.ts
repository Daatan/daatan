import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * White-label branding. The SaaS/unset path MUST stay byte-identical to the
 * previous hardcoded values (this is the prod-safety regression guard); the
 * self_hosted path requires explicit branding and never emits Daatan's tokens.
 */

const mockEnv: Record<string, unknown> = {}
vi.mock('@/env', () => ({ env: mockEnv }))

// Admin-set DB values (the cache) — drives the DB > env > default precedence.
const settingStore: Record<string, string> = {}
vi.mock('@/lib/services/settings', () => ({
  SETTING_KEYS: {
    appName: 'app_name',
    appLogoUrl: 'app_logo_url',
    aboutTitle: 'app_about_title',
    aboutBody: 'app_about_body',
    openrouterApiKey: 'openrouter_api_key',
    openrouterModel: 'openrouter_model',
  },
  getCachedSetting: (k: string) => settingStore[k],
}))

async function load() {
  vi.resetModules()
  return import('@/lib/branding')
}

describe('branding (SaaS / unset edition — must match the old literals)', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
    for (const k of Object.keys(settingStore)) delete settingStore[k]
  })

  it('defaults to the DAATAN identity', async () => {
    const b = await load()
    expect(b.getAppName()).toBe('DAATAN')
    expect(b.getAppUrl()).toBe('https://daatan.com')
  })

  it('ignores NEXTAUTH_URL for SaaS so prod/staging stay daatan.com', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    mockEnv.NEXTAUTH_URL = 'https://staging.daatan.com'
    const b = await load()
    expect(b.getAppUrl()).toBe('https://daatan.com')
  })

  it('getBranding snapshot defaults to DAATAN with no logo override', async () => {
    const b = await load()
    expect(b.getBranding()).toEqual({ appName: 'DAATAN', logoUrl: null })
  })

  it('getBranding carries the APP_LOGO_URL override', async () => {
    mockEnv.APP_LOGO_URL = 'https://cdn.example/logo.png'
    const b = await load()
    expect(b.getBranding()).toEqual({ appName: 'DAATAN', logoUrl: 'https://cdn.example/logo.png' })
  })

  it('emits the exact Google + Bing verification tokens', async () => {
    const b = await load()
    expect(b.getVerificationTokens()).toEqual({
      google: 'ATwti6XWdVyDu_RJlJhqcBsq-Z_lkjA7nq8ooac',
      bing: 'CAFA7BE0D5D83695993D635831499022',
    })
  })

  it('indexes only in production', async () => {
    mockEnv.NEXT_PUBLIC_ENV = 'production'
    expect((await load()).shouldIndex()).toBe(true)
    mockEnv.NEXT_PUBLIC_ENV = 'staging'
    expect((await load()).shouldIndex()).toBe(false)
  })
})

describe('branding (self_hosted)', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
    for (const k of Object.keys(settingStore)) delete settingStore[k]
    mockEnv.DAATAN_EDITION = 'self_hosted'
  })

  it('uses the operator-provided name and URL', async () => {
    mockEnv.APP_NAME = 'Acme Forecasting'
    mockEnv.APP_URL = 'https://forecast.acme.example/'
    const b = await load()
    expect(b.getAppName()).toBe('Acme Forecasting')
    expect(b.getAppUrl()).toBe('https://forecast.acme.example') // trailing slash trimmed
  })

  it('falls back APP_URL → NEXTAUTH_URL', async () => {
    mockEnv.APP_NAME = 'Acme'
    mockEnv.NEXTAUTH_URL = 'https://forecast.acme.example'
    expect((await load()).getAppUrl()).toBe('https://forecast.acme.example')
  })

  it('falls back to a neutral default name when nothing is set (boots unconfigured)', async () => {
    // Brand name is admin-editable at runtime, so a missing APP_NAME no longer
    // fails fast — the app boots as "Forecasting" until the admin sets it.
    const b = await load()
    expect(b.getAppName()).toBe('Forecasting')
  })

  it('uses APP_NAME env as the seed when no admin setting exists', async () => {
    mockEnv.APP_NAME = 'Acme'
    const b = await load()
    expect(b.getAppName()).toBe('Acme')
  })

  it('the admin-set DB name overrides the APP_NAME env seed (DB > env > default)', async () => {
    mockEnv.APP_NAME = 'Acme (env)'
    settingStore['app_name'] = 'Acme (admin)'
    const b = await load()
    expect(b.getAppName()).toBe('Acme (admin)')
  })

  it('the admin-set DB logo overrides APP_LOGO_URL env; getBranding carries it', async () => {
    mockEnv.APP_LOGO_URL = 'https://cdn/env.png'
    settingStore['app_logo_url'] = 'https://cdn/admin.png'
    const b = await load()
    expect(b.getAppLogoUrl()).toBe('https://cdn/admin.png')
    expect(b.getBranding().logoUrl).toBe('https://cdn/admin.png')
  })

  it('getAppLogoUrl falls back to the bundled asset when nothing is set', async () => {
    const b = await load()
    expect(b.getAppLogoUrl()).toBe('/logo-icon.svg')
    expect(b.getBranding().logoUrl).toBeNull()
  })

  it('still fails fast when APP_URL is missing (operationally required)', async () => {
    const b = await load()
    expect(() => b.getAppUrl()).toThrow(/APP_URL/)
  })

  it('never indexes and never emits Daatan verification tokens', async () => {
    mockEnv.APP_NAME = 'Acme'
    mockEnv.APP_URL = 'https://forecast.acme.example'
    mockEnv.NEXT_PUBLIC_ENV = 'production'
    const b = await load()
    expect(b.shouldIndex()).toBe(false)
    expect(b.getVerificationTokens()).toBeNull()
  })
})
