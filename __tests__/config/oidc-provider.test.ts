import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Verifies auth.config.ts registers the generic OIDC provider only when the
 * OIDC_* env vars are present — the gate that keeps the SaaS deploy unchanged.
 */

type ProviderLike = { id?: string; type?: string; name?: string }

function mockEnv(overrides: Record<string, unknown>) {
  vi.doMock('@/env', () => ({
    env: {
      APP_ENV: 'development',
      NEXTAUTH_SECRET: 'x'.repeat(32),
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      OIDC_ISSUER: undefined,
      OIDC_CLIENT_ID: undefined,
      OIDC_CLIENT_SECRET: undefined,
      OIDC_PROVIDER_NAME: undefined,
      ...overrides,
    },
  }))
}

async function loadProviders(): Promise<ProviderLike[]> {
  const mod = await import('@/auth.config')
  return mod.default.providers as ProviderLike[]
}

describe('auth.config OIDC provider registration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@/env')
  })

  it('registers an oidc provider when OIDC_* are all set', async () => {
    mockEnv({
      OIDC_ISSUER: 'https://idp.example/realms/main',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_CLIENT_SECRET: 'client-secret',
      OIDC_PROVIDER_NAME: 'Acme SSO',
    })
    const providers = await loadProviders()
    const oidc = providers.find((p) => p.id === 'oidc')
    expect(oidc).toBeDefined()
    expect(oidc?.type).toBe('oidc')
    expect(oidc?.name).toBe('Acme SSO')
  })

  it('defaults the provider name to "SSO" when OIDC_PROVIDER_NAME is unset', async () => {
    mockEnv({
      OIDC_ISSUER: 'https://idp.example/realms/main',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_CLIENT_SECRET: 'client-secret',
    })
    const providers = await loadProviders()
    expect(providers.find((p) => p.id === 'oidc')?.name).toBe('SSO')
  })

  it('registers no oidc provider when OIDC_* are unset (SaaS deploy)', async () => {
    mockEnv({})
    const providers = await loadProviders()
    expect(providers.some((p) => p.id === 'oidc')).toBe(false)
  })

  it('registers no oidc provider when only some OIDC_* are set', async () => {
    mockEnv({ OIDC_ISSUER: 'https://idp.example/realms/main' })
    const providers = await loadProviders()
    expect(providers.some((p) => p.id === 'oidc')).toBe(false)
  })
})
