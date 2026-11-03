import { describe, it, expect } from 'vitest'
import { deadlineEndsAt, isDeadlineToday, formatDdmmyyyy, normalizeResolveByDatetime, parseDdmmyyyy, parseTime24 } from '../date'

describe('formatDdmmyyyy', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(formatDdmmyyyy('2026-12-31')).toBe('31/12/2026')
    expect(formatDdmmyyyy('2027-01-05')).toBe('05/01/2027')
  })

  it('returns empty string for non-YYYY-MM-DD input', () => {
    expect(formatDdmmyyyy('')).toBe('')
    expect(formatDdmmyyyy('31/12/2026')).toBe('')
    expect(formatDdmmyyyy('2026-12-31T23:59')).toBe('')
  })
})

describe('parseDdmmyyyy', () => {
  it('parses day-first dates to YYYY-MM-DD', () => {
    expect(parseDdmmyyyy('31/12/2026')).toBe('2026-12-31')
    expect(parseDdmmyyyy('1/2/2026')).toBe('2026-02-01')
  })

  it('accepts dot and dash separators', () => {
    expect(parseDdmmyyyy('31.12.2026')).toBe('2026-12-31')
    expect(parseDdmmyyyy('31-12-2026')).toBe('2026-12-31')
  })

  it('ignores surrounding whitespace', () => {
    expect(parseDdmmyyyy(' 31/12/2026 ')).toBe('2026-12-31')
  })

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(parseDdmmyyyy('31/02/2026')).toBeNull()
    expect(parseDdmmyyyy('29/02/2027')).toBeNull() // not a leap year
    expect(parseDdmmyyyy('29/02/2028')).toBe('2028-02-29') // leap year
  })

  it('rejects month-first (American) input where the month is impossible', () => {
    expect(parseDdmmyyyy('12/31/2026')).toBeNull()
  })

  it('rejects incomplete or malformed input', () => {
    expect(parseDdmmyyyy('')).toBeNull()
    expect(parseDdmmyyyy('6')).toBeNull()
    expect(parseDdmmyyyy('31/12')).toBeNull()
    expect(parseDdmmyyyy('31/12/26')).toBeNull() // 2-digit year
    expect(parseDdmmyyyy('2026-12-31')).toBeNull() // ISO order not accepted here
  })
})

describe('parseTime24', () => {
  it('parses and zero-pads 24-hour times', () => {
    expect(parseTime24('9:05')).toBe('09:05')
    expect(parseTime24('18:30')).toBe('18:30')
    expect(parseTime24('00:00')).toBe('00:00')
    expect(parseTime24('23:59')).toBe('23:59')
  })

  it('rejects out-of-range and malformed times', () => {
    expect(parseTime24('24:00')).toBeNull()
    expect(parseTime24('12:60')).toBeNull()
    expect(parseTime24('1230')).toBeNull()
    expect(parseTime24('12')).toBeNull()
    expect(parseTime24('')).toBeNull()
    expect(parseTime24('6:5')).toBeNull() // minutes must be 2 digits
  })
})

describe('normalizeResolveByDatetime', () => {
  it('defaults to UTC, snapping to 23:59:59.999 of the given day', () => {
    const result = normalizeResolveByDatetime(new Date('2027-12-31T00:00:00Z'))
    expect(result.toISOString()).toBe('2027-12-31T23:59:59.999Z')
  })

  it('is idempotent — normalizing an already-normalized UTC instant is a no-op', () => {
    const once = normalizeResolveByDatetime(new Date('2027-12-31T00:00:00Z'))
    const twice = normalizeResolveByDatetime(once)
    expect(twice.toISOString()).toBe(once.toISOString())
  })

  it('fixes the #1363 regression: "by end of 2027" landing on Jan 1 instead of Dec 31', () => {
    // cmrjtst1b00bs01mq7ian6u1v was stored as 2028-01-01T22:59:59.999Z (23h late)
    const wrong = new Date('2028-01-01T22:59:59.999Z')
    expect(normalizeResolveByDatetime(wrong).toISOString()).toBe('2028-01-01T23:59:59.999Z')
  })

  it('snaps to end-of-day in Asia/Jerusalem (UTC+2 winter) — matches the 21:59 UTC audit bucket', () => {
    // 21:59:59 UTC on a winter day *is* 23:59:59 local in Jerusalem already.
    const result = normalizeResolveByDatetime(new Date('2027-01-15T21:59:59Z'), 'Asia/Jerusalem')
    expect(result.toISOString()).toBe('2027-01-15T21:59:59.999Z')
  })

  it('reads the intended day from the timezone wall clock, not the UTC date', () => {
    // 00:00 UTC on 2027-06-02 is already 04:00 local in Asia/Dubai (UTC+4) —
    // still June 2nd there, so end-of-day lands on the 2nd, not the 1st.
    const result = normalizeResolveByDatetime(new Date('2027-06-02T00:00:00Z'), 'Asia/Dubai')
    expect(result.toISOString()).toBe('2027-06-02T19:59:59.999Z')
  })

  it('rolls the intended day back a calendar date under a negative UTC offset', () => {
    // 03:00 UTC on 2027-06-02 is still 2027-06-01 23:00 in America/New_York (EDT, UTC-4 in June).
    const result = normalizeResolveByDatetime(new Date('2027-06-02T03:00:00Z'), 'America/New_York')
    expect(result.toISOString()).toBe('2027-06-02T03:59:59.999Z')
  })

  it('handles the 00:00-group failure mode: midnight no longer excludes the final day', () => {
    const midnightStart = new Date('2027-03-10T00:00:00Z')
    const result = normalizeResolveByDatetime(midnightStart, 'UTC')
    expect(result.getUTCDate()).toBe(10)
    expect(result.toISOString()).toBe('2027-03-10T23:59:59.999Z')
  })
})

describe('deadlineEndsAt', () => {
  it('ends a calendar-date stamp at midnight Israel summer time (UTC+3)', () => {
    expect(deadlineEndsAt(new Date('2026-10-23T23:59:59.000Z')).toISOString()).toBe('2026-10-23T21:00:00.000Z')
  })

  it('ends a calendar-date stamp at midnight Israel winter time (UTC+2)', () => {
    expect(deadlineEndsAt(new Date('2026-11-03T23:59:59.999Z')).toISOString()).toBe('2026-11-03T22:00:00.000Z')
  })

  it('uses the offset in force on the day before a DST change', () => {
    // Israel leaves summer time on Sunday 2026-10-25 at 02:00, after that midnight
    expect(deadlineEndsAt(new Date('2026-10-24T23:59:59.000Z')).toISOString()).toBe('2026-10-24T21:00:00.000Z')
    // and enters it on Friday 2027-03-26 at 02:00, also after that midnight
    expect(deadlineEndsAt(new Date('2027-03-25T23:59:59.000Z')).toISOString()).toBe('2027-03-25T22:00:00.000Z')
  })

  it('leaves an exact time as written', () => {
    expect(deadlineEndsAt(new Date('2026-11-03T14:30:00.000Z')).toISOString()).toBe('2026-11-03T14:30:00.000Z')
    expect(deadlineEndsAt(new Date('2026-11-03T22:59:00.000Z')).toISOString()).toBe('2026-11-03T22:59:00.000Z')
  })
})

describe('isDeadlineToday', () => {
  const deadline = '2026-11-03T23:59:59.000Z' // ends 22:00 UTC, Israel winter time
  const at = (iso: string) => new Date(iso).getTime()

  it('is true from Israeli midnight until the deadline ends', () => {
    expect(isDeadlineToday(deadline, at('2026-11-02T22:00:00.000Z'))).toBe(true)
    expect(isDeadlineToday(deadline, at('2026-11-03T21:59:59.000Z'))).toBe(true)
  })

  it('is false the day before and once it has ended', () => {
    expect(isDeadlineToday(deadline, at('2026-11-02T21:59:59.000Z'))).toBe(false)
    expect(isDeadlineToday(deadline, at('2026-11-03T22:00:00.000Z'))).toBe(false)
  })

  it('handles an exact-time deadline by its Israeli date', () => {
    expect(isDeadlineToday('2026-11-03T14:30:00.000Z', at('2026-11-03T06:00:00.000Z'))).toBe(true)
    expect(isDeadlineToday('2026-11-03T14:30:00.000Z', at('2026-11-02T06:00:00.000Z'))).toBe(false)
  })
})
