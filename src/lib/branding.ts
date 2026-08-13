import { env } from '@/env'
import { isSelfHosted } from '@/lib/edition'
import { getCachedSetting, SETTING_KEYS } from '@/lib/services/settings'

/**
 * White-label branding. The SaaS edition keeps the literal DAATAN identity
 * (prod is byte-identical when APP_* are unset). The self_hosted edition brands
 * itself from admin-editable runtime settings (DB) → APP_NAME env → a neutral
 * default, so a fresh install always boots and the admin sets the real name
 * live in the UI. APP_URL is still required (operationally needed for canonical
 * URLs / OIDC redirects), so a missing value there still fails fast. Email
 * accessors (getNoreplyEmail/getContactEmail) inherit that same fail-fast via
 * getAppUrl() when no explicit EMAIL_FROM/CONTACT_EMAIL is set.
 *
 * Server-only (reads DAATAN_EDITION). Used by metadata, robots, sitemap.
 */

const SAAS_NAME = 'DAATAN'
const SAAS_URL = 'https://daatan.com'
const SAAS_NOREPLY_EMAIL = 'Daatan <noreply@daatan.com>'
const SAAS_CONTACT_EMAIL = 'office@daatan.com'
const SELF_HOST_DEFAULT_NAME = 'Forecasting'

/** Display name for titles / siteName / prompts. */
export function getAppName(): string {
  if (isSelfHosted()) {
    return getCachedSetting(SETTING_KEYS.appName) || env.APP_NAME || SELF_HOST_DEFAULT_NAME
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

/** Transactional email "From" header (verification, password reset, notifications). */
export function getNoreplyEmail(): string {
  if (isSelfHosted()) {
    return env.EMAIL_FROM || `noreply@${new URL(getAppUrl()).hostname}`
  }
  return SAAS_NOREPLY_EMAIL
}

/** Contact address shown on legal/about pages. */
export function getContactEmail(): string {
  if (isSelfHosted()) {
    return env.CONTACT_EMAIL || `office@${new URL(getAppUrl()).hostname}`
  }
  return SAAS_CONTACT_EMAIL
}

/** Logo override URL (admin setting → APP_LOGO_URL env), or null for the bundled asset. */
function getLogoOverride(): string | null {
  if (isSelfHosted()) {
    return getCachedSetting(SETTING_KEYS.appLogoUrl) || env.APP_LOGO_URL || null
  }
  return env.APP_LOGO_URL ?? null
}

/** Logo asset for the UI; operators override via the admin setting or APP_LOGO_URL. */
export function getAppLogoUrl(): string {
  return getLogoOverride() || '/logo-icon.svg'
}

export interface Branding {
  appName: string
  /** Operator logo override (any URL), or null to use each surface's bundled asset. */
  logoUrl: string | null
}

/** Snapshot handed to the client BrandingProvider from the root layout. */
export function getBranding(): Branding {
  return { appName: getAppName(), logoUrl: getLogoOverride() }
}

/**
 * Whether this instance should be indexed by search engines. A self-hosted
 * (internal) instance is never indexed; SaaS indexes in production only.
 */
export function shouldIndex(): boolean {
  if (isSelfHosted()) return false
  // APP_ENV (not NEXT_PUBLIC_ENV): staging and production run the same
  // promoted Docker image, so a build-time-inlined var reads the build's
  // origin, not which instance this actually is. APP_ENV is set per-instance
  // at container runtime — see src/env.ts.
  return env.APP_ENV === 'production'
}

/** Site-verification tokens — only meaningful for the SaaS daatan.com property. */
export function getVerificationTokens(): { google: string; bing: string } | null {
  if (isSelfHosted()) return null
  return { google: 'ATwti6XWdVyDu_RJlJhqcBsq-Z_lkjA7nq8ooac', bing: 'CAFA7BE0D5D83695993D635831499022' }
}
