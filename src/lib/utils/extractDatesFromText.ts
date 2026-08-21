/**
 * Regex-based extraction of explicit calendar dates from claim text, used to
 * cross-check `resolveByDatetime` at forecast creation (daatan#1404 — this is
 * what would have caught #1363's "end of summer 2026" and the Somaliland
 * pair's silent one-day drift, at creation time instead of via a later audit).
 *
 * Deliberately NOT an LLM call: this runs synchronously on the human-facing
 * creation path (`POST /api/forecasts`) and needs to stay cheap and
 * deterministic. The LLM-based `claimDeadline` classifier
 * (`temporal-classifier.ts`) already exists but is async/best-effort and
 * fires *after* creation — no use blocking the request on it.
 *
 * Deliberately only matches *unambiguous* phrasings gated behind "by"/
 * "before" (or an unambiguous ISO date) — vague language like "end of summer
 * 2026" must NOT match, so ordinary claim text and genuinely ambiguous
 * deadlines fall through uncontested rather than false-positive block.
 *
 * Dates are constructed directly via `Date.UTC` (not date-fns `parse` against
 * a `new Date()` reference) so the result never depends on server-local
 * timezone — an invalid day/month combo (e.g. "31 February") is rejected by a
 * round-trip check, the same pattern `parseDdmmyyyy` in `date.ts` uses.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const MONTH_PATTERN = `(${MONTH_NAMES.join('|')})`

// "2026-08-31" (no trigger word, treated like "by"), "before 2027-01-01"
// (trigger captured so the day-before adjustment below applies to it too).
const ISO_DATE_RE = /\b(?:(by|before)\s+)?(\d{4})-(\d{2})-(\d{2})\b/gi

// "by the end of 2026", "before end of 2027" — deliberately requires the
// year to immediately follow "end of"; "end of summer 2026" has "summer" in
// between and correctly does NOT match. Already end-anchored on Dec 31, so
// "before end of <year>" needs no day-before adjustment the way "before
// <exact date>" does below.
const END_OF_YEAR_RE = /\b(?:by|before)\s+(?:the\s+)?end\s+of\s+(\d{4})\b/gi

// "by August 31, 2026", "before August 31 2026", "by Aug 31st, 2026"
const MONTH_DAY_YEAR_RE = new RegExp(
  `\\b(by|before)\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
  'gi',
)

// "by 31 August 2026", "before 1st December 2026"
const DAY_MONTH_YEAR_RE = new RegExp(
  `\\b(by|before)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\s+(\\d{4})\\b`,
  'gi',
)

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** UTC end-of-day instant for (year, monthIndex 0-11, day), or null if the combo isn't a real calendar date. */
function endOfUtcDay(year: number, monthIndex: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex || d.getUTCDate() !== day) return null
  return d
}

/**
 * "By <date>" means the deadline IS that date; "before <date>" means the day
 * before it (ms arithmetic, so it rolls over months/years correctly). A
 * missing/undefined trigger (the bare-ISO-date case) is treated like "by".
 */
function boundaryForTrigger(trigger: string | undefined, namedDate: Date): Date {
  return trigger?.toLowerCase() === 'before' ? new Date(namedDate.getTime() - ONE_DAY_MS) : namedDate
}

/**
 * Extract every explicit, unambiguous date mentioned in `text`. Returns an
 * empty array when no explicit date phrase is found — callers must treat
 * that as "nothing to check" rather than a mismatch.
 */
export function extractDatesFromClaimText(text: string): Date[] {
  const dates: Date[] = []

  for (const m of text.matchAll(ISO_DATE_RE)) {
    const d = endOfUtcDay(Number(m[2]), Number(m[3]) - 1, Number(m[4]))
    if (d) dates.push(boundaryForTrigger(m[1], d))
  }

  for (const m of text.matchAll(END_OF_YEAR_RE)) {
    const d = endOfUtcDay(Number(m[1]), 11, 31)
    if (d) dates.push(d)
  }

  for (const m of text.matchAll(MONTH_DAY_YEAR_RE)) {
    const d = endOfUtcDay(Number(m[4]), MONTH_NAMES.indexOf(m[2].toLowerCase()), Number(m[3]))
    if (d) dates.push(boundaryForTrigger(m[1], d))
  }

  for (const m of text.matchAll(DAY_MONTH_YEAR_RE)) {
    const d = endOfUtcDay(Number(m[4]), MONTH_NAMES.indexOf(m[3].toLowerCase()), Number(m[2]))
    if (d) dates.push(boundaryForTrigger(m[1], d))
  }

  return dates
}

/** Calendar day (UTC) as a comparable epoch-ms key, ignoring time-of-day. */
function utcDayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Cross-check claim text against the stored `resolveByDatetime`. Returns the
 * mismatching extracted date, or `null` when there's nothing to flag —
 * either no explicit date phrase was found (skip, don't false-positive), or
 * at least one extracted date agrees with `resolveByDatetime`'s calendar day
 * (a claim mentioning an agreeing date alongside incidental other dates
 * should not block).
 */
export function findClaimTextDeadlineMismatch(claimText: string, resolveByDatetime: Date): Date | null {
  const extracted = extractDatesFromClaimText(claimText)
  if (extracted.length === 0) return null

  const resolveDay = utcDayKey(resolveByDatetime)
  const agrees = extracted.some(d => utcDayKey(d) === resolveDay)
  return agrees ? null : extracted[0]
}
