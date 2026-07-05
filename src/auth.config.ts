import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { env } from "@/env"

// NOTE: This file is imported by `src/middleware.ts`, which runs in the Edge
// runtime. It MUST NOT import Prisma, bcrypt, or any other Node-only module.
// The Credentials provider (and the Playwright test provider) both need DB
// access and therefore live in `src/auth.ts`, which runs on Node.
// APP_ENV, not NEXT_PUBLIC_ENV: staging and production run the same promoted
// Docker image, so this must read the runtime instance var — see src/env.ts.
const isHosted = env.APP_ENV === 'staging' || env.APP_ENV === 'production'

// Register Google only when credentials are present. The SaaS edition always
// sets these; a self-hosted install authenticates via OIDC/SAML (Phase 1) or
// credentials, and boots fine with no Google provider. Locals (not env.*) so
// TypeScript narrows the optional values to `string` inside the branch.
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env
const googleProviders =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? [
        Google({
          clientId: GOOGLE_CLIENT_ID,
          clientSecret: GOOGLE_CLIENT_SECRET,
          allowDangerousEmailAccountLinking: false,
        }),
      ]
    : []

// Generic OIDC provider for enterprise SSO (self-host). Registered only when all
// three vars are present. A plain config object — no Node-only imports — so this
// stays Edge-safe (auth.config.ts is bundled into the middleware). Issuer
// metadata is discovered at runtime in the Node route handler.
const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET } = env
const oidcProviders =
  OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET
    ? [
        {
          id: 'oidc',
          name: env.OIDC_PROVIDER_NAME || 'SSO',
          type: 'oidc' as const,
          issuer: OIDC_ISSUER,
          clientId: OIDC_CLIENT_ID,
          clientSecret: OIDC_CLIENT_SECRET,
          // Single-org self-host: the issuer is the org's trusted IdP, so link to
          // an existing account with the same email rather than erroring.
          allowDangerousEmailAccountLinking: true,
        },
      ]
    : []

export default {
  secret: env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [...googleProviders, ...oidcProviders],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
        session.user.role = token.role ?? 'USER'
        session.user.username = token.username ?? undefined
        session.user.rs = token.rs
        if (token.name) session.user.name = token.name
        if (token.picture) session.user.image = token.picture as string
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        // user is NextAuth User — augmented to include role, username, rs
        token.role = user.role
        token.username = user.username
        token.rs = user.rs
      }
      return token
    },
  },
  // Must live here (not only in auth.ts) so the Edge middleware reads the same
  // cookie names that the Node.js handler writes.
  ...(isHosted && {
    cookies: {
      sessionToken: {
        name: `__Secure-next-auth.session-token`,
        options: { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: true },
      },
      callbackUrl: {
        name: `__Secure-next-auth.callback-url`,
        options: { sameSite: 'lax' as const, path: '/', secure: true },
      },
      csrfToken: {
        name: `__Secure-next-auth.csrf-token`,
        options: { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: true },
      },
      pkceCodeVerifier: {
        name: `__Secure-next-auth.pkce.code_verifier`,
        options: { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: true, maxAge: 900 },
      },
      state: {
        name: `__Secure-next-auth.state`,
        options: { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: true, maxAge: 900 },
      },
      nonce: {
        name: `__Secure-next-auth.nonce`,
        options: { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: true },
      },
    },
  }),
} satisfies NextAuthConfig
