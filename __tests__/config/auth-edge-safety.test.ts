/**
 * Auth middleware edge-safety tests.
 *
 * Background:
 *   src/proxy.ts (formerly middleware.ts) is kept Edge-safe. It imports auth.config.ts,
 *   which transitively pulls every module listed there into the Edge bundle.
 *
 *   Prisma and bcryptjs both rely on Node-only APIs (crypto, fs, child_process,
 *   native addons) and cannot execute on the Edge. When they end up in the
 *   middleware bundle the runtime throws a minified "X is not a constructor"
 *   error on the FIRST cold-start request (e.g. GET /admin), producing a 500.
 *
 *   We hit this in production in April 2026 with the admin RSC payload route:
 *     TypeError: a is not a constructor
 *       at <unknown> (.next/server/src/middleware.js:...)
 *       at c (.next/server/edge-runtime-webpack.js:...)
 *
 * These tests read auth.config.ts source directly and fail the build if anyone
 * reintroduces a Node-only import there. The Credentials provider (which needs
 * Prisma + bcrypt) belongs in src/auth.ts, which is loaded from Node routes
 * only.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const AUTH_CONFIG_PATH = path.join(ROOT, 'src/auth.config.ts')

const FORBIDDEN_IMPORTS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /from\s+['"]@\/lib\/prisma['"]/,
    reason: 'Prisma cannot execute on the Edge runtime. Move DB-touching providers to src/auth.ts.',
  },
  {
    pattern: /from\s+['"]@prisma\/client['"]/,
    reason: 'Prisma cannot execute on the Edge runtime. Move DB-touching providers to src/auth.ts.',
  },
  {
    pattern: /from\s+['"]bcryptjs?['"]/,
    reason: 'bcryptjs relies on Node-only APIs. Move the Credentials provider to src/auth.ts.',
  },
  {
    pattern: /from\s+['"]fs['"]/,
    reason: 'The "fs" module is not available on the Edge runtime.',
  },
  {
    pattern: /from\s+['"]node:/,
    reason: 'node: imports are not available on the Edge runtime.',
  },
]

describe('auth.config.ts must be Edge-safe (imported by middleware)', () => {
  const src = fs.readFileSync(AUTH_CONFIG_PATH, 'utf-8')

  for (const { pattern, reason } of FORBIDDEN_IMPORTS) {
    it(`does not import a Node-only module matching ${pattern}`, () => {
      expect(
        pattern.test(src),
        `src/auth.config.ts contains a forbidden import (${pattern}). ${reason}`,
      ).toBe(false)
    })
  }

  it('does not define a Credentials provider (it must live in src/auth.ts)', () => {
    // The Credentials provider needs Prisma + bcrypt to verify passwords.
    // Putting it in auth.config.ts drags those into the Edge bundle.
    const hasCredentialsImport = /from\s+['"]next-auth\/providers\/credentials['"]/.test(src)
    expect(
      hasCredentialsImport,
      'src/auth.config.ts imports next-auth/providers/credentials. The Credentials provider ' +
      'uses Prisma and bcrypt, which are not Edge-safe. Move it to src/auth.ts.',
    ).toBe(false)
  })
})
