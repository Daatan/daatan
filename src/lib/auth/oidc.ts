import type { UserRole } from '@prisma/client'

/**
 * Parse OIDC_ADMIN_EMAILS (comma/space/newline separated) into a normalized,
 * lowercased set of email addresses.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Map an authenticated email to a role override for the admin-bootstrap list,
 * or null when the email isn't listed (no override). Case-insensitive.
 */
export function resolveAdminRole(
  email: string | null | undefined,
  adminEmails: Set<string>
): UserRole | null {
  if (!email) return null
  return adminEmails.has(email.toLowerCase()) ? 'ADMIN' : null
}
