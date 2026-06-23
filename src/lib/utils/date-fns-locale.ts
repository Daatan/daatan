import type { Locale } from 'date-fns'
import { he, ru, eo } from 'date-fns/locale'

const MAP: Record<string, Locale> = { he, ru, eo }

/**
 * Map a next-intl locale code to a date-fns Locale for relative-time helpers
 * like formatDistanceToNow. Returns undefined for `en` (and anything unmapped),
 * which makes date-fns fall back to its English default.
 */
export function dateFnsLocale(locale: string): Locale | undefined {
  return MAP[locale]
}
