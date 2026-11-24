import { describe, it, expect } from 'vitest'
import { getDefaultHorizon, findUngroundedYears } from '../expressPrediction'

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

// daatan#2199: "end of the current year" gave a six-week deadline on 2026-11-15.
describe('getDefaultHorizon', () => {
  it('is the end of the current year while 90+ days remain', () => {
    expect(getDefaultHorizon(new Date('2026-09-15T12:00:00Z'))).toEqual({
      iso: '2026-12-31T23:59:59Z', human: 'December 31, 2026', year: 2026,
    })
  })

  it('rolls to the end of next year inside the last 90 days', () => {
    expect(getDefaultHorizon(new Date('2026-11-15T17:00:00Z'))).toEqual({
      iso: '2027-12-31T23:59:59Z', human: 'December 31, 2027', year: 2027,
    })
  })

  it('does not flag the rolled-over default year as ungrounded', () => {
    const now = new Date('2026-11-15T17:00:00Z')
    expect(findUngroundedYears('Rust returns to the TIOBE top 10 by December 31, 2027', '2027-12-31T23:59:59Z', '', now)).toEqual([])
    // ...but the same year is still suspect while the default is this year
    expect(findUngroundedYears('X by December 31, 2027', '2027-12-31T23:59:59Z', '', new Date('2026-06-01T00:00:00Z'))).toEqual(['2027'])
  })

  it('flags nothing when the draft found its dates by search (daatan#2290)', () => {
    const now = new Date('2026-11-23T00:00:00Z')
    // Election date in the claim, inauguration as the resolution date: both from search.
    const claim = 'A Democrat wins the US presidential election held on November 7, 2028'
    expect(findUngroundedYears(claim, '2029-01-20T23:59:59Z', '', now)).toEqual(['2028', '2029'])
    expect(findUngroundedYears(claim, '2029-01-20T23:59:59Z', '', now, { datesFromSearch: true })).toEqual([])
  })
})
