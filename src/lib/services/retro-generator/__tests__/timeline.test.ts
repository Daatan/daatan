import { describe, it, expect } from 'vitest'
import { formatDeadline, fillDeadline, parsePublished, retroDeadline, retroTimeline } from '../timeline'

const now = new Date('2026-11-17T12:00:00Z')
const d = (s: string) => new Date(s)

describe('retroTimeline', () => {
  it('puts T0 a week before the event day, and the evidence window 45 days before that', () => {
    const t = retroTimeline('2026-11-10', [d('2026-11-10T15:00:00Z'), d('2026-11-11T08:00:00Z')], now)
    expect(t.ok && t.timeline.cutoffAt.toISOString()).toBe('2026-11-10T00:00:00.000Z')
    expect(t.ok && t.timeline.asOf.toISOString()).toBe('2026-11-03T00:00:00.000Z')
    expect(t.ok && t.timeline.evidenceAfter.toISOString()).toBe('2026-09-19T00:00:00.000Z')
    expect(t.ok && t.timeline.deadline.toISOString()).toBe('2026-11-30T23:59:59.999Z')
  })

  it('cuts off at a report from the evening before the event day (an announcement ahead of the act)', () => {
    const t = retroTimeline('2026-11-12', [d('2026-11-11T18:30:00Z'), d('2026-11-12T10:00:00Z')], now)
    expect(t.ok && t.timeline.cutoffAt.toISOString()).toBe('2026-11-11T18:30:00.000Z')
    expect(t.ok && t.timeline.asOf.toISOString()).toBe('2026-11-04T00:00:00.000Z')
    expect(t.ok && t.timeline.earlyReports).toBe(0)
  })

  it('does not let a report dated days before the event day drag T0 back (a bad pool date or a precursor)', () => {
    const t = retroTimeline('2026-11-08', [d('2026-11-01T09:00:00Z'), d('2026-11-08T12:00:00Z'), d('2026-11-09T08:00:00Z')], now)
    expect(t.ok && t.timeline.cutoffAt.toISOString()).toBe('2026-11-08T00:00:00.000Z')
    expect(t.ok && t.timeline.asOf.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(t.ok && t.timeline.earlyReports).toBe(1)
  })

  it('refuses an undated, malformed, future, stale or post-report event day', () => {
    const reports = [d('2026-11-10T15:00:00Z')]
    expect(retroTimeline('', reports, now)).toEqual({ ok: false, reason: 'undated' })
    expect(retroTimeline('2026-02-30', reports, now)).toEqual({ ok: false, reason: 'bad_event_date' })
    expect(retroTimeline('2026-11-20', [d('2026-11-21T00:00:00Z')], now)).toEqual({ ok: false, reason: 'event_in_future' })
    expect(retroTimeline('2026-09-01', reports, now)).toEqual({ ok: false, reason: 'stale_event' })
    expect(retroTimeline('2026-11-12', reports, now)).toEqual({ ok: false, reason: 'event_after_reports' })
    expect(retroTimeline('2026-11-10', [], now)).toEqual({ ok: false, reason: 'no_report_dates' })
  })
})

describe('retroDeadline', () => {
  it('is the end of the event month, or of the next month inside the last three days', () => {
    expect(retroDeadline(d('2026-11-27T00:00:00Z')).toISOString()).toBe('2026-11-30T23:59:59.999Z')
    expect(retroDeadline(d('2026-11-28T00:00:00Z')).toISOString()).toBe('2026-12-31T23:59:59.999Z')
    expect(retroDeadline(d('2026-12-30T00:00:00Z')).toISOString()).toBe('2027-01-31T23:59:59.999Z')
  })
})

describe('deadline wording', () => {
  it('fills the judge token with the date daatan claims use', () => {
    const deadline = d('2026-11-30T23:59:59.999Z')
    expect(formatDeadline(deadline)).toBe('November 30, 2026')
    expect(fillDeadline('X will happen by {DEADLINE}.', deadline)).toBe('X will happen by November 30, 2026.')
  })
})

describe('parsePublished', () => {
  it('reads a bare date as UTC midnight and rejects junk', () => {
    expect(parsePublished('2026-11-10')?.toISOString()).toBe('2026-11-10T00:00:00.000Z')
    expect(parsePublished('2026-11-10T15:00:00+02:00')?.toISOString()).toBe('2026-11-10T13:00:00.000Z')
    expect(parsePublished('yesterday')).toBeNull()
    expect(parsePublished(null)).toBeNull()
  })
})
