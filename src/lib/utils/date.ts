/**
 * Date utilities for timezone-aware input handling.
 *
 * Problem: <input type="date"> returns a naive "YYYY-MM-DD" string with no
 * timezone. Appending "T23:59:59.999Z" treats it as UTC end-of-day, which is
 * wrong for non-UTC users (e.g. a user in UTC+3 sees their "today" shifted).
 *
 * Solution: always interpret date-picker strings as local time, then let
 * `.toISOString()` convert to UTC for storage.
 */

/**
 * Convert a "YYYY-MM-DD" string from <input type="date"> to a Date at
 * 23:59:59.999 in the user's local timezone.
 */
export function localEndOfDay(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  // month is 1-based in date strings, 0-based in Date constructor
  return new Date(year, month - 1, day, 23, 59, 59, 999)
}

/**
 * Format a Date for <input type="datetime-local"> (value="YYYY-MM-DDTHH:MM")
 * using the user's local timezone. Needed when loading a UTC datetime from the
 * server — toISOString() would give UTC which the input then misinterprets.
 */
export function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * Format a date for display in a **hydration-safe** way: fixed `en-US` locale
 * and UTC timezone, so the server and the client emit byte-identical text. This
 * lets date-bearing content render in the initial SSR HTML (so crawlers see it)
 * without an `isMounted` gate or a hydration mismatch. Returns '' for invalid
 * input. Use UTC-stable display anywhere the value must appear in the server HTML
 * (SEO); use the locale-aware `toLocaleString` only for client-only chrome.
 */
export function formatDisplayDate(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Like {@link formatDisplayDate} but with the time of day; renders an explicit "UTC" suffix. */
export function formatDisplayDateTime(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}
