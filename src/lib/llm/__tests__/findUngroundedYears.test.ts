import { describe, it, expect } from 'vitest'
import { findUngroundedYears } from '../expressPrediction'

// Frozen "today" for every case: mid-2026, matching the #1086 incident window.
const NOW = new Date('2026-07-13T12:00:00Z')

describe('findUngroundedYears', () => {
  it('flags a future year in the claim that appears nowhere in the grounding text (#1086 incident shape)', () => {
    expect(
      findUngroundedYears(
        'Knesset elections will be held by December 31, 2027',
        '2027-12-31T23:59:59Z',
        'next Knesset elections\n[Article 1] Coalition tensions rise in Jerusalem',
        NOW,
      ),
    ).toEqual(['2027'])
  })

  it('flags a future resolveBy year even when the claim itself names no year', () => {
    expect(
      findUngroundedYears(
        'The next Knesset elections will take place',
        '2027-12-31T23:59:59Z',
        'next Knesset elections',
        NOW,
      ),
    ).toEqual(['2027'])
  })

  it('accepts a future year stated in the user input', () => {
    expect(
      findUngroundedYears(
        'X will happen before March 2027',
        '2027-03-31T23:59:59Z',
        'will X happen before March 2027?',
        NOW,
      ),
    ).toEqual([])
  })

  it('accepts a future year stated in an article snippet', () => {
    expect(
      findUngroundedYears(
        'Elections will be held by November 2028',
        '2028-11-30T23:59:59Z',
        'US elections\n[Article 1] The vote is scheduled for November 2028, officials said',
        NOW,
      ),
    ).toEqual([])
  })

  it('never flags the current year (rule-3 end-of-year default)', () => {
    expect(
      findUngroundedYears(
        'Bitcoin will reach $100k by December 31, 2026',
        '2026-12-31T23:59:59Z',
        'bitcoin 100k',
        NOW,
      ),
    ).toEqual([])
  })

  it('never flags current+5 (rule-3a relative-timing default)', () => {
    expect(
      findUngroundedYears(
        'A will happen before B, resolved by July 13, 2031',
        '2031-07-13T23:59:59Z',
        'will A happen before B',
        NOW,
      ),
    ).toEqual([])
  })

  it('ignores past years — they are context, not guesses', () => {
    expect(
      findUngroundedYears(
        'The streak that began in 2022 will end this year',
        '2026-12-31T23:59:59Z',
        'sports streak',
        NOW,
      ),
    ).toEqual([])
  })

  it('reports each ungrounded year once, sorted', () => {
    expect(
      findUngroundedYears(
        'Phase one lands in 2029 and phase two in 2028',
        '2029-12-31T23:59:59Z',
        'the two-phase rollout',
        NOW,
      ),
    ).toEqual(['2028', '2029'])
  })

  it('does not match year-like digits embedded in larger numbers', () => {
    expect(
      findUngroundedYears(
        'The index will close above 12027 points this year',
        '2026-12-31T23:59:59Z',
        'stock index prediction',
        NOW,
      ),
    ).toEqual([])
  })
})
