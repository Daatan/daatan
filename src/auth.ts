import NextAuth from "next-auth"
import type { Session, User } from "next-auth"
import type { JWT } from "next-auth/jwt"
import type { UserRole } from "@prisma/client"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { env } from "@/env"
import authConfig from "./auth.config"
import type { Adapter } from "next-auth/adapters"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { notifyNewUserRegistered } from "@/lib/services/telegram"
import { parseAdminEmails, resolveAdminRole } from "@/lib/auth/oidc"
import { isEmailDomainAllowed, parseAllowedDomains } from "@/lib/auth/access"

const log = createLogger('auth')

const isTest = process.env.PLAYWRIGHT_TEST === 'true'
const isStaging = env.NEXT_PUBLIC_ENV === 'staging'
const isHosted = env.NEXT_PUBLIC_ENV === 'staging' || env.NEXT_PUBLIC_ENV === 'production'

// Merge Edge-compatible config (`authConfig`, used by middleware) with Node-only
// features: Prisma adapter, bcrypt-backed Credentials provider, and the
// Playwright test provider. Keeping these out of `auth.config.ts` is required
// for middleware to bundle cleanly into the Edge runtime.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma) as Adapter,
  debug: isStaging || env.NEXTAUTH_DEBUG === 'true',
  providers: [
    ...authConfig.providers,
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email) }
        })

        if (!user || !user.password) {
          return null
        }

        const isValid = await bcrypt.compare(String(credentials.password), user.password)

        if (!isValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          username: user.username,
          rs: user.rs,
        }
      }
    }),
    ...(isTest ? [
      Credentials({
        id: 'playwright',
        name: 'Playwright Test',
        credentials: {
          userId: { label: "User ID", type: "text" },
          role: { label: "Role", type: "text" }
        },
        async authorize(credentials) {
          if (!credentials?.userId) return null

          const user = await prisma.user.upsert({
            where: { id: credentials.userId as string },
            update: { role: (credentials.role as UserRole) || 'USER' },
            create: {
              id: credentials.userId as string,
              email: `${credentials.userId}@test.daatan.com`,
              name: `Test User ${credentials.userId}`,
              username: `testuser_${credentials.userId}`,
              role: (credentials.role as UserRole) || 'USER',
            }
          })

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
            username: user.username,
            rs: user.rs,
          }
        }
      })
    ] : [])
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Domain allow-list gate. Applies to every provider (OIDC auto-provisioning,
    // credentials), so only company identities can ever get an account in a
    // self-host. No-op when ALLOWED_EMAIL_DOMAINS is unset (the SaaS deploy).
    async signIn({ user }) {
      const allowedDomains = parseAllowedDomains(env.ALLOWED_EMAIL_DOMAINS)
      if (allowedDomains.size === 0) return true
      if (isEmailDomainAllowed(user?.email, allowedDomains)) return true
      log.warn({ email: user?.email }, 'Sign-in blocked: email domain not allowed')
      return false
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      // First call base session callback.
      // NextAuth's session callback is overloaded (JWT vs database strategy), so we
      // narrow to the JWT-strategy signature used by this app before calling.
      if (authConfig.callbacks?.session) {
        type JwtSessionFn = (p: { session: Session; token: JWT }) => Promise<Session>
        session = await (authConfig.callbacks.session as unknown as JwtSessionFn)({ session, token })
      }

      if (session.user && token.sub) {
        if (token.userDeleted) {
          log.warn({ userId: token.sub }, 'Session user not found in DB — invalidating session')
          session.expires = new Date(0).toISOString()
          return session
        }
      }
      return session
    },
    async jwt({ token, user, trigger, session, account, profile }) {
      // First call base jwt callback.
      // NextAuth's jwt callback params type is broad; narrow to the shape we pass here.
      if (authConfig.callbacks?.jwt) {
        type JwtFn = (p: Parameters<typeof authConfig.callbacks.jwt>[0]) => Promise<JWT>
        token = await (authConfig.callbacks.jwt as unknown as JwtFn)({ token, user, trigger, session, account, profile })
      }

      const TTL = 5 * 60 * 1000 // 5 minutes
      const isSignIn = !!user
      const cachedAt = token.cachedAt as number | undefined
      const stale = !cachedAt || Date.now() - cachedAt > TTL

      // Admin bootstrap: promote configured emails (e.g. the org's SSO admins) to
      // ADMIN on sign-in. No-op when OIDC_ADMIN_EMAILS is unset (the SaaS deploy).
      // Runs before the DB read below so the cached token picks up the new role.
      if (isSignIn && token.sub) {
        const adminRole = resolveAdminRole(user?.email, parseAdminEmails(env.OIDC_ADMIN_EMAILS))
        if (adminRole) {
          try {
            await prisma.user.update({ where: { id: token.sub }, data: { role: adminRole } })
          } catch (error) {
            log.error({ err: error }, 'Failed to apply admin-email role mapping')
          }
        }
      }

      if ((isSignIn || stale) && token.sub) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { role: true, username: true, name: true, image: true, avatarUrl: true, rs: true },
          })

          if (!dbUser) {
            token.userDeleted = true
            return token
          }

          token.role = dbUser.role
          token.username = dbUser.username
          token.name = dbUser.name ?? token.name
          token.picture = dbUser.avatarUrl || dbUser.image || token.picture
          token.rs = dbUser.rs
          token.cachedAt = Date.now()
          token.userDeleted = undefined
        } catch (error) {
          log.error({ err: error }, 'Error fetching user for JWT cache')
        }
      }
      return token
    },
  },
  events: {
    createUser: async ({ user }) => {
      try {
        await prisma.cuTransaction.create({
          data: {
            userId: user.id!,
            type: 'INITIAL_GRANT',
            amount: 100,
            balanceAfter: 100,
            note: 'Welcome bonus',
          },
        })

        // Notify Telegram about new user registration
        notifyNewUserRegistered({
          email: user.email!,
          name: user.name,
          provider: 'google', // createUser event is usually for OAuth providers
        })
      } catch (error) {
        log.error({ err: error }, 'Failed to create initial grant or notify registration')
      }
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  ...(isHosted && {
    cookies: {
      sessionToken: {
        name: `__Secure-next-auth.session-token`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: true,
        },
      },
      callbackUrl: {
        name: `__Secure-next-auth.callback-url`,
        options: {
          sameSite: 'lax',
          path: '/',
          secure: true,
        },
      },
      csrfToken: {
        name: `__Secure-next-auth.csrf-token`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: true,
        },
      },
      pkceCodeVerifier: {
        name: `__Secure-next-auth.pkce.code_verifier`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: true,
          maxAge: 900,
        },
      },
      state: {
        name: `__Secure-next-auth.state`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: true,
          maxAge: 900,
        },
      },
      nonce: {
        name: `__Secure-next-auth.nonce`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: true,
        },
      },
    },
  }),
})
