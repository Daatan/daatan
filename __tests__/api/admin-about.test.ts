import { vi, describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

// withAuth → invoke handler directly with a fake admin user.
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (h: (req: NextRequest, u: unknown, c: unknown) => unknown) =>
    (req: NextRequest) => h(req, { id: 'a1', role: 'ADMIN' }, { params: {} }),
}))

vi.mock('@/env', () => ({
  env: {
    DAATAN_EDITION: 'self_hosted',
    APP_NAME: 'Acme Forecasting',
    APP_URL: 'https://forecast.acme.example',
    GEMINI_API_KEY: 'super-secret-gemini-key',
    ORACLE_URL: 'https://oracle',
    ORACLE_API_KEY: 'oracle-secret',
    OIDC_ISSUER: 'https://idp',
    OIDC_CLIENT_ID: 'cid',
    OIDC_CLIENT_SECRET: 'oidc-secret',
    OIDC_ADMIN_EMAILS: 'admin@acme.example',
    ALLOWED_EMAIL_DOMAINS: 'acme.example',
    STORAGE_DRIVER: 'minio',
    TELEGRAM_BOT_TOKEN: undefined,
    NEWS_INDEXER_URL: undefined,
    EMAIL_FROM: 'noreply@acme.example',
  },
}))

describe('GET /api/admin/about', () => {
  it('reports edition/capabilities/integrations as booleans without leaking secrets', async () => {
    const { GET } = await import('@/app/api/admin/about/route')
    const res = await GET(new NextRequest('http://localhost/api/admin/about'), { params: Promise.resolve({}) } as never)
    const body = await res.json()

    expect(body.edition).toBe('self_hosted')
    expect(body.appName).toBe('Acme Forecasting')
    expect(body.capabilities.ai).toBe(false) // self_hosted + ENABLE_AI_FEATURES unset
    expect(body.auth.oidc).toBe(true)
    expect(body.auth.domainAllowlist).toBe(true)
    expect(body.auth.openSignup).toBe(false)
    expect(body.storage.driver).toBe('minio')
    expect(body.integrations.gemini).toBe(true)
    expect(body.integrations.oracle).toBe(true)
    expect(body.integrations.email).toBe(true)
    expect(body.integrations.telegram).toBe(false)
    expect(body.integrations.newsIndexer).toBe(false)

    // No secret values anywhere in the payload.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('super-secret-gemini-key')
    expect(raw).not.toContain('oracle-secret')
    expect(raw).not.toContain('oidc-secret')
  })
})
