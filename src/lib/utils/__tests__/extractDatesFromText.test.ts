import { describe, it, expect } from 'vitest'
import { extractDatesFromClaimText, findClaimTextDeadlineMismatch } from '../extractDatesFromText'

describe('extractDatesFromClaimText', () => {
  it('extracts an ISO date', () => {
    const dates = extractDatesFromClaimText('Resolves on 2026-08-31.')
    expect(dates).toHaveLength(1)
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(7) // August, 0-indexed
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('extracts "by end of <year>"', () => {
    // Regression fixture: daatan#1363's Somaliland pair — claim said "by the
    // end of 2027" while one of the two rows silently resolved 2028-01-01.
    const dates = extractDatesFromClaimText('The US will officially recognise Somaliland by the end of 2027.')
    expect(dates).toHaveLength(1)
    expect(dates[0].getUTCFullYear()).toBe(2027)
    expect(dates[0].getUTCMonth()).toBe(11) // December
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('extracts "before end of <year>" too', () => {
    const dates = extractDatesFromClaimText('Must happen before the end of 2030.')
    expect(dates[0].getUTCFullYear()).toBe(2030)
  })

  it('extracts "by <Day> <Month> <Year>"', () => {
    // Regression fixture: daatan#1363's corrected claim text for
    // cmrd8tkok… ("Rockets or drones ... by 31 August 2026").
    const dates = extractDatesFromClaimText(
      'Rockets or drones are launched directly from Israel to Iran, or from Iran to Israel, by 31 August 2026.',
    )
    expect(dates).toHaveLength(1)
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(7)
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('extracts "by <Month> <Day>, <Year>"', () => {
    const dates = extractDatesFromClaimText('This resolves by August 31, 2026 at the latest.')
    expect(dates).toHaveLength(1)
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(7)
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('extracts "by <Month> <Day> <Year>" without a comma, with an ordinal suffix', () => {
    const dates = extractDatesFromClaimText('Due by December 1st 2026.')
    expect(dates).toHaveLength(1)
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(11)
    expect(dates[0].getUTCDate()).toBe(1)
  })

  it('does NOT match vague "end of summer <year>" (no unambiguous date)', () => {
    // The original (pre-correction) daatan#1363 wording — must stay
    // unmatched so the ambiguous-but-not-wrong case doesn't false-positive.
    const dates = extractDatesFromClaimText(
      'Rockets or drones are launched directly from Israel to Iran, or from Iran to Israel, by the end of summer 2026.',
    )
    expect(dates).toHaveLength(0)
  })

  it('does NOT match ordinary claim text with unrelated numbers', () => {
    const dates = extractDatesFromClaimText('Candidate X will win 50% of voters in the 2026 election.')
    expect(dates).toHaveLength(0)
  })

  it('does NOT match a bare month/year with no day', () => {
    const dates = extractDatesFromClaimText('The vote is expected in March 2026.')
    expect(dates).toHaveLength(0)
  })

  it('rejects an impossible calendar date (Feb 30)', () => {
    const dates = extractDatesFromClaimText('Resolves by 30 February 2026.')
    expect(dates).toHaveLength(0)
  })

  it('is case-insensitive on month names and trigger words', () => {
    const dates = extractDatesFromClaimText('BEFORE 31 august 2026 this must happen.')
    expect(dates).toHaveLength(1)
  })

  // Regression fixtures for daatan#1541: "before <exact date>" names the day
  // AFTER the deadline (the deadline is the day before), unlike "by <exact
  // date>" where the named date IS the deadline.
  it('extracts "before <Month> <Day>, <Year>" as the day before the named date', () => {
    const dates = extractDatesFromClaimText('Resolves YES if Iran conducts a nuclear test before January 1, 2027.')
    expect(dates).toHaveLength(1)
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(11) // December
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('extracts "before <Day> <Month> <Year>" as the day before the named date', () => {
    const dates = extractDatesFromClaimText('Must happen before 1 January 2027.')
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(11)
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('extracts "before <ISO date>" as the day before the named date', () => {
    const dates = extractDatesFromClaimText('Must happen before 2027-01-01.')
    expect(dates[0].getUTCFullYear()).toBe(2026)
    expect(dates[0].getUTCMonth()).toBe(11)
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('a bare ISO date with no trigger word is still treated like "by" (unchanged)', () => {
    const dates = extractDatesFromClaimText('Resolves on 2026-08-31.')
    expect(dates[0].getUTCMonth()).toBe(7)
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('"before" rolls over a year boundary correctly', () => {
    const dates = extractDatesFromClaimText('Must happen before January 1, 2026.')
    expect(dates[0].getUTCFullYear()).toBe(2025)
    expect(dates[0].getUTCMonth()).toBe(11)
    expect(dates[0].getUTCDate()).toBe(31)
  })

  it('"by <exact date>" is unaffected — the named date IS the deadline', () => {
    const dates = extractDatesFromClaimText('Must happen by January 1, 2027.')
    expect(dates[0].getUTCFullYear()).toBe(2027)
    expect(dates[0].getUTCMonth()).toBe(0)
    expect(dates[0].getUTCDate()).toBe(1)
  })
})

describe('findClaimTextDeadlineMismatch', () => {
  it('is null when the claim has no explicit date phrase', () => {
    expect(findClaimTextDeadlineMismatch('Candidate X will win the election.', new Date('2026-12-31T23:59:59Z'))).toBeNull()
  })

  it('is null when the extracted date agrees with resolveByDatetime', () => {
    const resolveByDatetime = new Date('2026-08-31T23:59:59Z')
    const mismatch = findClaimTextDeadlineMismatch(
      'Rockets or drones are launched directly from Israel to Iran, or from Iran to Israel, by 31 August 2026.',
      resolveByDatetime,
    )
    expect(mismatch).toBeNull()
  })

  it('ignores time-of-day when comparing — only the calendar day must agree', () => {
    // resolveByDatetime stored at a non-23:59:59 instant on the same day (the
    // exact drift daatan#1367 documents) should still agree with the claim.
    const resolveByDatetime = new Date('2026-08-31T12:59:00Z')
    const mismatch = findClaimTextDeadlineMismatch('Must happen by 31 August 2026.', resolveByDatetime)
    expect(mismatch).toBeNull()
  })

  it('flags a mismatch: daatan#1363 Somaliland pair shape (claim says 2027, stored 2028-01-01)', () => {
    const resolveByDatetime = new Date('2028-01-01T22:59:59.999Z')
    const mismatch = findClaimTextDeadlineMismatch(
      'The US will officially recognise Somaliland by the end of 2027.',
      resolveByDatetime,
    )
    expect(mismatch).not.toBeNull()
    expect(mismatch!.getUTCFullYear()).toBe(2027)
  })

  it('flags a mismatch: explicit day/month/year disagrees with a wildly different stored deadline', () => {
    const resolveByDatetime = new Date('2027-01-01T00:00:00Z')
    const mismatch = findClaimTextDeadlineMismatch('Must happen by 31 August 2026.', resolveByDatetime)
    expect(mismatch).not.toBeNull()
  })

  it('does not flag vague "end of summer" wording — nothing explicit to disagree with', () => {
    // The pre-correction #1363 wording paired with its (also wrong at the
    // time) stored deadline: no explicit phrase means skip, not block.
    const resolveByDatetime = new Date('2026-09-01T12:59:00Z')
    const mismatch = findClaimTextDeadlineMismatch(
      'Rockets or drones are launched directly from Israel to Iran, or from Iran to Israel, by the end of summer 2026.',
      resolveByDatetime,
    )
    expect(mismatch).toBeNull()
  })

  it('daatan#1541 repro: "before January 1, 2027" agrees with a Dec 31, 2026 deadline (was a false-positive block)', () => {
    const resolveByDatetime = new Date('2026-12-31T23:59:59Z')
    const mismatch = findClaimTextDeadlineMismatch(
      'Resolves YES if Iran conducts a nuclear test before January 1, 2027. Otherwise, resolved as No.',
      resolveByDatetime,
    )
    expect(mismatch).toBeNull()
  })

  it('"before <date>" still correctly flags a genuine mismatch', () => {
    const resolveByDatetime = new Date('2026-06-30T23:59:59Z')
    const mismatch = findClaimTextDeadlineMismatch('Must happen before January 1, 2027.', resolveByDatetime)
    expect(mismatch).not.toBeNull()
  })
})
