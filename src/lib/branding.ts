import { env } from '@/env'

/**
 * White-label branding. The SaaS edition keeps the literal DAATAN identity
 * (prod is byte-identical when APP_* are unset). The self_hosted edition MUST
 * brand itself: APP_NAME / APP_URL are required there, so a missing value
 * throws a clear error rather than silently shipping "DAATAN".
 *
 * Server-only (reads DAATAN_EDITION). Used by metadata, robots, sitemap.
 */

const SAAS_NAME = 'DAATAN'
const SAAS_URL = 'https://daatan.com'

function isSelfHosted(): boolean {
  return env.DAATAN_EDITION === 'self_hosted'
}

/** Display name for titles / siteName / prompts. */
export function getAppName(): string {
  if (env.APP_NAME) return env.APP_NAME
  if (isSelfHosted()) {
    throw new Error('APP_NAME is required when DAATAN_EDITION=self_hosted — set it in your environment.')
  }
  return SAAS_NAME
}

/** Canonical base URL (no trailing slash). */
export function getAppUrl(): string {
  const explicit = env.APP_URL || (isSelfHosted() ? env.NEXTAUTH_URL : undefined)
  if (explicit) return explicit.replace(/\/$/, '')
  if (isSelfHosted()) {
    throw new Error('APP_URL (or NEXTAUTH_URL) is required when DAATAN_EDITION=self_hosted — set it in your environment.')
  }
  // SaaS: always the literal, regardless of NEXTAUTH_URL, so prod + staging
  // metadata stay byte-identical to the previous hardcoded value.
  return SAAS_URL
}

/** Logo asset for the UI; operators override via APP_LOGO_URL. */
export function getAppLogoUrl(): string {
  return env.APP_LOGO_URL || '/logo-icon.svg'
}

export interface Branding {
  appName: string
  /** Operator logo override (any URL), or null to use each surface's bundled asset. */
  logoUrl: string | null
}

/** Snapshot handed to the client BrandingProvider from the root layout. */
export function getBranding(): Branding {
  return { appName: getAppName(), logoUrl: env.APP_LOGO_URL ?? null }
}

/**
 * Whether this instance should be indexed by search engines. A self-hosted
 * (internal) instance is never indexed; SaaS indexes in production only.
 */
export function shouldIndex(): boolean {
  if (isSelfHosted()) return false
  return env.NEXT_PUBLIC_ENV === 'production'
}

/** Site-verification tokens — only meaningful for the SaaS daatan.com property. */
export function getVerificationTokens(): { google: string; bing: string } | null {
  if (isSelfHosted()) return null
  return { google: 'ATwti6XWdVyDu_RJlJhqcBsq-Z_lkjA7nq8ooac', bing: 'CAFA7BE0D5D83695993D635831499022' }
}
