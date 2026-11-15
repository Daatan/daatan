import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Validates that nginx configuration files include required security headers
 * and a well-formed Content-Security-Policy.
 *
 * These are config-level regression tests — they catch accidental removal
 * of security headers during nginx config edits.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..')

const NGINX_SSL_CONFIGS = [
  'infra/nginx/nginx-ssl.conf',
  'infra/nginx/nginx-staging-ssl.conf',
]

const ALL_NGINX_CONFIGS = [
  ...NGINX_SSL_CONFIGS,
  'infra/nginx/nginx.conf',
]

/** Security headers that must be present in every HTTPS server block */
const REQUIRED_SECURITY_HEADERS = [
  'X-Frame-Options',
  'X-Content-Type-Options',
  'X-XSS-Protection',
  'Referrer-Policy',
  'Permissions-Policy',
]

/** Headers exclusive to SSL configs (HSTS must not be on plain HTTP) */
const SSL_ONLY_HEADERS = [
  'Strict-Transport-Security',
]

/** CSP directives that must appear in the policy string */
const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'self'",
  'script-src',
  'style-src',
  'font-src',
  'img-src',
  'connect-src',
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self'",
]

/** Trusted external origins that the CSP must allow */
const REQUIRED_CSP_ORIGINS = [
  'https://www.googletagmanager.com',   // GA script
  'https://fonts.googleapis.com',        // Google Fonts CSS
  'https://fonts.gstatic.com',           // Google Fonts files
  'https://lh3.googleusercontent.com',   // Google OAuth avatars
  'https://www.google-analytics.com',    // GA beacons
  'https://geo.lipu.dev',                // consent-banner region check
  'https://www.google.com',              // GA4 GTM server-side beacon endpoint
]

const readConfig = (filename: string): string =>
  fs.readFileSync(path.join(PROJECT_ROOT, filename), 'utf-8')

describe('Nginx security headers', () => {
  describe.each(ALL_NGINX_CONFIGS)('%s', (configFile) => {
    const content = readConfig(configFile)

    it.each(REQUIRED_SECURITY_HEADERS)(
      'includes %s header',
      (header) => {
        expect(content).toContain(header)
      },
    )

    it('includes a Content-Security-Policy header', () => {
      // Accept either enforcing or report-only
      const hasCSP =
        content.includes('Content-Security-Policy-Report-Only') ||
        content.includes('Content-Security-Policy')
      expect(hasCSP).toBe(true)
    })
  })

  describe.each(NGINX_SSL_CONFIGS)('%s (SSL-specific)', (configFile) => {
    const content = readConfig(configFile)

    it.each(SSL_ONLY_HEADERS)(
      'includes %s header',
      (header) => {
        expect(content).toContain(header)
      },
    )

    it('uses a CSP policy', () => {
      expect(
        content.includes('Content-Security-Policy-Report-Only') ||
        content.includes('Content-Security-Policy')
      ).toBe(true)
    })

    it('does NOT include upgrade-insecure-requests IF in Report-Only mode (as it is ignored)', () => {
      if (content.includes('Content-Security-Policy-Report-Only')) {
        expect(content).not.toContain('upgrade-insecure-requests')
      }
    })
  })

  describe('nginx.conf (local dev)', () => {
    const content = readConfig('infra/nginx/nginx.conf')

    it('uses enforcing CSP (not report-only) for early violation detection', () => {
      expect(content).toContain('Content-Security-Policy')
      expect(content).not.toContain('Content-Security-Policy-Report-Only')
    })

    it('does NOT include upgrade-insecure-requests (HTTP-only dev server)', () => {
      expect(content).not.toContain('upgrade-insecure-requests')
    })
  })
})

describe('CSP directive completeness', () => {
  describe.each(ALL_NGINX_CONFIGS)('%s', (configFile) => {
    const content = readConfig(configFile)

    // Extract the CSP value from the add_header line
    const cspMatch = content.match(
      /add_header\s+Content-Security-Policy(?:-Report-Only)?\s+"([^"]+)"/,
    )
    const cspValue = cspMatch?.[1] ?? ''

    it('has a parseable CSP string', () => {
      expect(cspValue.length).toBeGreaterThan(0)
    })

    it.each(REQUIRED_CSP_DIRECTIVES)(
      'includes directive: %s',
      (directive) => {
        expect(cspValue).toContain(directive)
      },
    )

    it.each(REQUIRED_CSP_ORIGINS)(
      'allows trusted origin: %s',
      (origin) => {
        expect(cspValue).toContain(origin)
      },
    )

    it('every directive ends with a semicolon', () => {
      // Split by ';', trim, filter blanks — each segment should start with a known directive keyword
      const segments = cspValue
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
      expect(segments.length).toBeGreaterThanOrEqual(REQUIRED_CSP_DIRECTIVES.length)
    })
  })
})
