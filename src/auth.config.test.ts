/**
 * @jest-environment node
 * Coverage for the Edge-compatible session callback in src/auth.config.ts.
 * This is the base callback both src/auth.ts's Node override AND
 * src/middleware.ts's Edge `auth()` instance share — see src/auth.ts and
 * withAuth (src/lib/api-middleware.ts), which both rely on a cleared
 * session.user.id/role to treat a deleted user's still-valid JWT as
 * unauthenticated rather than trusting stale cached claims (daatan#1316).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }))

const envMock: Record<string, string | undefined> = {
  APP_ENV: 'development',
  NEXTAUTH_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  OIDC_ISSUER: undefined,
  OIDC_CLIENT_ID: undefined,
  OIDC_CLIENT_SECRET: undefined,
  OIDC_PROVIDER_NAME: undefined,
}
vi.mock('@/env', () => ({ env: envMock }))

async function loadSessionCallback() {
  vi.resetModules()
  const { default: authConfig } = await import('./auth.config')
  const session = authConfig.callbacks?.session as unknown as (p: {
    session: { user: { id: string; role: string; username?: string | null; rs?: number; name?: string; image?: string } | null }
    token: Record<string, unknown>
  }) => Promise<{ user: { id: string; role: string } | null }>
  if (!session) throw new Error('session callback not found on auth.config default export')
  return session
}

describe('auth.config.ts session callback', () => {
  it('clears user.id and role when the JWT flags the user as deleted', async () => {
    const session = await loadSessionCallback()
    const result = await session({
      session: { user: { id: 'u1', role: 'ADMIN' } },
      token: { sub: 'u1', userDeleted: true, role: 'ADMIN' },
    })
    expect(result.user?.id).toBe('')
    expect(result.user?.role).toBe('USER')
  })

  it('populates identity fields as usual for a live user', async () => {
    const session = await loadSessionCallback()
    const result = await session({
      session: { user: { id: 'stale', role: 'USER' } },
      token: { sub: 'u1', userDeleted: false, role: 'ADMIN', username: 'alice', rs: 120 },
    })
    expect(result.user?.id).toBe('u1')
    expect(result.user?.role).toBe('ADMIN')
  })

  it('is a no-op when the session has no user', async () => {
    const session = await loadSessionCallback()
    const result = await session({
      session: { user: null },
      token: { sub: 'u1', userDeleted: true },
    })
    expect(result.user).toBeNull()
  })
})
