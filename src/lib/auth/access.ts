/**
 * Parse ALLOWED_EMAIL_DOMAINS (comma/space/newline separated) into a normalized,
 * lowercased set of bare domains. A leading "@" is tolerated ("@acme.com" →
 * "acme.com"). Returns an empty set when unset — meaning "no restriction".
 */
export function parseAllowedDomains(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean)
  )
}

/**
 * Whether an email's domain is permitted. An empty allow-list means no
 * restriction (the SaaS default). Matching is case-insensitive and exact —
 * no subdomain wildcards. A malformed/empty email is rejected when a list is
 * configured.
 */
export function isEmailDomainAllowed(
  email: string | null | undefined,
  allowedDomains: Set<string>
): boolean {
  if (allowedDomains.size === 0) return true
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && allowedDomains.has(domain)
}

/**
 * Whether public (credentials) signup is open. The SaaS edition is always open;
 * a self-hosted install is closed by default and opts in via
 * SELF_HOST_OPEN_SIGNUP=true. Anything other than the explicit 'self_hosted'
 * edition is treated as SaaS, so an unset edition (e.g. tests) stays open.
 */
export function isOpenSignupEnabled(
  edition: 'saas' | 'self_hosted' | undefined,
  openSignupFlag: string | undefined
): boolean {
  if (edition !== 'self_hosted') return true
  return openSignupFlag === 'true'
}
