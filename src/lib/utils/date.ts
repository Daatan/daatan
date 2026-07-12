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

const pad = (n: number) => String(n).padStart(2, '0')

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

/**
 * Day-first text entry, used by DateTimeField instead of the native
 * datetime-local input whose display order follows the browser locale
 * (month-first for en-US users) rather than the site's DD/MM/YYYY convention.
 */

/** "YYYY-MM-DD" → "DD/MM/YYYY". Returns '' for input not in YYYY-MM-DD form. */
export function formatDdmmyyyy(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Parse day-first text ("31/12/2026", also "." or "-" separators, 1-digit day
 * and month allowed) to "YYYY-MM-DD". Returns null unless the text is a
 * complete, real calendar date with a 4-digit year.
 */
export function parseDdmmyyyy(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (!m) return null
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Round-trip through Date to reject impossible dates like 31/02 (the
  // constructor would silently roll them over into the next month).
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Parse 24-hour time text ("9:05", "18:30") to "HH:MM"; null if invalid. */
export function parseTime24(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const [hours, minutes] = [Number(m[1]), Number(m[2])]
  if (hours > 23 || minutes > 59) return null
  return `${pad(hours)}:${m[2]}`
}
