/**
 * @jest-environment node
 * Coverage for the NextAuth callback logic wired up in src/auth.ts: the
 * domain allow-list gate (signIn), session invalidation for deleted users,
 * and the jwt callback's admin-bootstrap + DB role cache.
 *
 * NextAuth() itself is mocked so we can capture the config object passed to
 * it and invoke the callbacks directly, without booting a real auth stack.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { capturedConfig, mockNextAuth } = vi.hoisted(() => {
  const capturedConfig: { current: Record<string, unknown> | null } = { current: null }
  const mockNextAuth = vi.fn((config: Record<string, unknown>) => {
    capturedConfig.current = config
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    }
  })
  return { capturedConfig, mockNextAuth }
})

vi.mock('next-auth', () => ({ default: mockNextAuth }))

vi.mock('./auth.config', () => ({
  default: {
    providers: [],
    callbacks: {
      // Base callbacks just echo their input, matching the shape auth.ts expects.
      session: vi.fn(async ({ session }: { session: unknown }) => session),
      jwt: vi.fn(async ({ token }: { token: unknown }) => token),
    },
  },
}))

vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: vi.fn(() => ({})) }))

const mockUserFindUnique = vi.fn()
const mockUserUpdate = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const mockNotifyNewUserRegistered = vi.fn()
vi.mock('@/lib/services/telegram', () => ({
  notifyNewUserRegistered: (...args: unknown[]) => mockNotifyNewUserRegistered(...args),
}))

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn() },
  compare: vi.fn(),
}))

const envMock: Record<string, string | undefined> = {
  APP_ENV: 'development',
  ALLOWED_EMAIL_DOMAINS: undefined,
  OIDC_ADMIN_EMAILS: undefined,
  NEXTAUTH_DEBUG: undefined,
}
vi.mock('@/env', () => ({ env: envMock }))

beforeEach(() => {
  vi.clearAllMocks()
  envMock.APP_ENV = 'development'
  envMock.ALLOWED_EMAIL_DOMAINS = undefined
  envMock.OIDC_ADMIN_EMAILS = undefined
  envMock.NEXTAUTH_DEBUG = undefined
  capturedConfig.current = null
})

async function loadAuthCallbacks() {
  vi.resetModules()
  await import('./auth')
  const config = capturedConfig.current
  if (!config) throw new Error('NextAuth config was not captured')
  return config.callbacks as {
    signIn: (p: { user: { email?: string | null } }) => Promise<boolean>
    session: (p: { session: { user?: { id: string } | null; expires: string }; token: Record<string, unknown> }) => Promise<{ expires: string }>
    jwt: (p: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

describe('auth.ts NextAuth callbacks', () => {
  describe('signIn (domain allow-list gate)', () => {
    it('allows sign-in when ALLOWED_EMAIL_DOMAINS is unset (SaaS default)', async () => {
      const { signIn } = await loadAuthCallbacks()
      await expect(signIn({ user: { email: 'anyone@example.com' } })).resolves.toBe(true)
    })

    it('allows sign-in when the email domain is on the allow-list', async () => {
      envMock.ALLOWED_EMAIL_DOMAINS = 'acme.com'
      const { signIn } = await loadAuthCallbacks()
      await expect(signIn({ user: { email: 'alice@acme.com' } })).resolves.toBe(true)
    })

    it('blocks sign-in when the email domain is not on the allow-list', async () => {
      envMock.ALLOWED_EMAIL_DOMAINS = 'acme.com'
      const { signIn } = await loadAuthCallbacks()
      await expect(signIn({ user: { email: 'eve@evil.com' } })).resolves.toBe(false)
    })

    it('blocks sign-in with no email when a domain allow-list is configured', async () => {
      envMock.ALLOWED_EMAIL_DOMAINS = 'acme.com'
      const { signIn } = await loadAuthCallbacks()
      await expect(signIn({ user: {} })).resolves.toBe(false)
    })
  })

  describe('session callback', () => {
    it('invalidates the session when the JWT flags the user as deleted', async () => {
      const { session } = await loadAuthCallbacks()
      const result = await session({
        session: { user: { id: 'u1' }, expires: '2099-01-01T00:00:00.000Z' },
        token: { sub: 'u1', userDeleted: true },
      })
      expect(result.expires).toBe(new Date(0).toISOString())
    })

    it('passes through an unmodified session for a live user', async () => {
      const { session } = await loadAuthCallbacks()
      const result = await session({
        session: { user: { id: 'u1' }, expires: '2099-01-01T00:00:00.000Z' },
        token: { sub: 'u1', userDeleted: false },
      })
      expect(result.expires).toBe('2099-01-01T00:00:00.000Z')
    })

    it('is a no-op when the session has no user', async () => {
      const { session } = await loadAuthCallbacks()
      const result = await session({
        session: { user: null, expires: '2099-01-01T00:00:00.000Z' },
        token: { sub: 'u1' },
      })
      expect(result.expires).toBe('2099-01-01T00:00:00.000Z')
    })
  })

  describe('jwt callback', () => {
    it('promotes a configured admin email to ADMIN on sign-in', async () => {
      envMock.OIDC_ADMIN_EMAILS = 'admin@acme.com'
      mockUserFindUnique.mockResolvedValue({
        role: 'ADMIN', username: 'admin', name: 'Admin', image: null, avatarUrl: null, rs: 0,
      })
      const { jwt } = await loadAuthCallbacks()

      await jwt({
        token: { sub: 'u1' },
        user: { email: 'admin@acme.com' },
        trigger: 'signIn',
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { role: 'ADMIN' } })
    })

    it('does not promote a non-admin email', async () => {
      envMock.OIDC_ADMIN_EMAILS = 'admin@acme.com'
      mockUserFindUnique.mockResolvedValue({
        role: 'USER', username: 'u', name: 'U', image: null, avatarUrl: null, rs: 0,
      })
      const { jwt } = await loadAuthCallbacks()

      await jwt({
        token: { sub: 'u1' },
        user: { email: 'someone@else.com' },
        trigger: 'signIn',
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(mockUserUpdate).not.toHaveBeenCalled()
    })

    it('flags the token as userDeleted when the DB user no longer exists', async () => {
      mockUserFindUnique.mockResolvedValue(null)
      const { jwt } = await loadAuthCallbacks()

      const result = await jwt({
        token: { sub: 'ghost' },
        user: { email: 'ghost@acme.com' },
        trigger: 'signIn',
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(result.userDeleted).toBe(true)
    })

    it('refreshes role/username from the DB on sign-in and caches the timestamp', async () => {
      mockUserFindUnique.mockResolvedValue({
        role: 'APPROVER', username: 'mod1', name: 'Mod One', image: null, avatarUrl: 'http://x/a.png', rs: 42,
      })
      const { jwt } = await loadAuthCallbacks()

      const result = await jwt({
        token: { sub: 'u1' },
        user: { email: 'mod1@acme.com' },
        trigger: 'signIn',
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(result.role).toBe('APPROVER')
      expect(result.username).toBe('mod1')
      expect(result.rs).toBe(42)
      expect(result.picture).toBe('http://x/a.png')
      expect(typeof result.cachedAt).toBe('number')
    })

    it('skips the DB refresh when the cache is fresh and not a sign-in', async () => {
      const { jwt } = await loadAuthCallbacks()

      const result = await jwt({
        token: { sub: 'u1', cachedAt: Date.now(), role: 'USER' },
        user: undefined,
        trigger: undefined,
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(mockUserFindUnique).not.toHaveBeenCalled()
      expect(result.role).toBe('USER')
    })

    it('refreshes when the cache is stale even without a fresh sign-in', async () => {
      mockUserFindUnique.mockResolvedValue({
        role: 'ADMIN', username: 'a', name: 'A', image: null, avatarUrl: null, rs: 1,
      })
      const { jwt } = await loadAuthCallbacks()

      const staleTimestamp = Date.now() - 10 * 60 * 1000 // 10 minutes ago, TTL is 5
      const result = await jwt({
        token: { sub: 'u1', cachedAt: staleTimestamp, role: 'USER' },
        user: undefined,
        trigger: undefined,
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(mockUserFindUnique).toHaveBeenCalled()
      expect(result.role).toBe('ADMIN')
    })

    it('logs and keeps the token unchanged when the DB lookup throws', async () => {
      mockUserFindUnique.mockRejectedValue(new Error('db down'))
      const { jwt } = await loadAuthCallbacks()

      const result = await jwt({
        token: { sub: 'u1', role: 'USER' },
        user: { email: 'u1@acme.com' },
        trigger: 'signIn',
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(result.role).toBe('USER')
    })

    it('is a no-op when the token has no sub', async () => {
      const { jwt } = await loadAuthCallbacks()

      const result = await jwt({
        token: {},
        user: undefined,
        trigger: undefined,
        session: undefined,
        account: null,
        profile: undefined,
      })

      expect(mockUserFindUnique).not.toHaveBeenCalled()
      expect(result).toEqual({})
    })
  })
})
