/**
 * The dates a retro simulation stands on (daatan#2217).
 *
 * - **cutoffAt**: the earliest moment the outcome was public — the event's day, or the first
 *   report of it when one came up to {@link EARLY_REPORT_TOLERANCE_DAYS} earlier (time zones, an
 *   announcement the evening before). A report dated further back is not moved onto: the judge
 *   saw its date and still put the event later. Of 22 events judged on 2026-11-17, 5 had T0
 *   pulled 10–15 days before the event by such a report, each a pool date that was wrong (an
 *   aa.com.tr live page dated 11-01 saying "tasked on 2026-11-08") or a precursor fact the
 *   clustering swept in.
 * - **asOf (T0)**: the simulated forecast date, the cutoff's UTC day minus {@link LOOKBACK_DAYS}.
 *   Evidence is articles published strictly before T0; Oracul answers as of T0.
 * - **deadline**: the claim's "by" date, the end of the event's month. An event in the last
 *   {@link MONTH_END_MARGIN_DAYS} days of a month moves it to the end of the next, so the
 *   question a forecaster would have asked does not hinge on a few days' slack.
 */

export const LOOKBACK_DAYS = 7
/** How far before T0 evidence may reach. */
export const EVIDENCE_WINDOW_DAYS = 45
export const MONTH_END_MARGIN_DAYS = 3
/** An event dated this long before its first report is background, not the news. */
export const MAX_EVENT_LEAD_DAYS = 30
/** How much earlier than the event day a report may set the cutoff. */
export const EARLY_REPORT_TOLERANCE_DAYS = 1

const DAY_MS = 86_400_000

export interface RetroTimeline {
  eventDate: Date
  cutoffAt: Date
  asOf: Date
  evidenceAfter: Date
  deadline: Date
  /** Reports dated more than the tolerance before the event day, left out of the cutoff. */
  earlyReports: number
}

export type TimelineResult =
  | { ok: true; timeline: RetroTimeline }
  | { ok: false; reason: 'undated' | 'bad_event_date' | 'event_in_future' | 'stale_event' | 'event_after_reports' | 'no_report_dates' }

export function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? null : d
}

/** A pool row's `published_date`, which is "as reported by the source" and not always ISO. */
export function parsePublished(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value)
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function endOfUtcMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 1) - 1)
}

export function retroDeadline(eventDate: Date): Date {
  const y = eventDate.getUTCFullYear()
  const m = eventDate.getUTCMonth()
  const end = endOfUtcMonth(y, m)
  return end.getTime() - eventDate.getTime() < MONTH_END_MARGIN_DAYS * DAY_MS ? endOfUtcMonth(y, m + 1) : end
}

/** "November 30, 2026" — the wording daatan claims use for a "by" date. */
export function formatDeadline(deadline: Date): string {
  return deadline.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/**
 * Validate the judge's event day against the reports and derive the timeline. The day must
 * not be after today or after the last report (reports say it happened), and not more than
 * {@link MAX_EVENT_LEAD_DAYS} before the first report (then it is background, not this week's news).
 */
export function retroTimeline(eventDay: string, reportDates: Date[], now: Date = new Date()): TimelineResult {
  if (!eventDay) return { ok: false, reason: 'undated' }
  const eventDate = parseDay(eventDay)
  if (!eventDate) return { ok: false, reason: 'bad_event_date' }
  if (reportDates.length === 0) return { ok: false, reason: 'no_report_dates' }
  if (eventDate.getTime() > now.getTime()) return { ok: false, reason: 'event_in_future' }

  const first = Math.min(...reportDates.map((d) => d.getTime()))
  const last = Math.max(...reportDates.map((d) => d.getTime()))
  if (eventDate.getTime() > startOfUtcDay(new Date(last)).getTime()) return { ok: false, reason: 'event_after_reports' }
  if (first - eventDate.getTime() > MAX_EVENT_LEAD_DAYS * DAY_MS) return { ok: false, reason: 'stale_event' }

  const floor = eventDate.getTime() - EARLY_REPORT_TOLERANCE_DAYS * DAY_MS
  const onEvent = reportDates.map((d) => d.getTime()).filter((ms) => ms >= floor)
  const cutoffAt = new Date(Math.min(eventDate.getTime(), ...onEvent))
  const asOf = new Date(startOfUtcDay(cutoffAt).getTime() - LOOKBACK_DAYS * DAY_MS)
  return {
    ok: true,
    timeline: {
      eventDate,
      cutoffAt,
      asOf,
      evidenceAfter: new Date(asOf.getTime() - EVIDENCE_WINDOW_DAYS * DAY_MS),
      deadline: retroDeadline(eventDate),
      earlyReports: reportDates.length - onEvent.length,
    },
  }
}

/** Fill the judge's {DEADLINE} token. */
export function fillDeadline(template: string, deadline: Date): string {
  return template.replace(/\{DEADLINE\}/g, formatDeadline(deadline))
}
