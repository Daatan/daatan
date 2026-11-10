import { describe, it, expect } from 'vitest'
import {
  marketDisplayProbability,
  trackedOutcomeLabel,
  marketLineName,
  marketDeadlineDeltaDays,
  marketDeadlineMismatch,
  marketDivergenceBound,
  marketDivergenceGap,
} from '../market-display'

describe('marketDisplayProbability', () => {
  it('passes the raw price through when not inverted', () => {
    expect(marketDisplayProbability(42, false)).toBe(42)
  })

  it('shows 100 − price when inverted', () => {
    expect(marketDisplayProbability(42, true)).toBe(58)
    expect(marketDisplayProbability(0, true)).toBe(100)
  })
})

describe('trackedOutcomeLabel', () => {
  it('is null for a standard Yes/No market (any casing)', () => {
    expect(trackedOutcomeLabel(['Yes', 'No'])).toBeNull()
    expect(trackedOutcomeLabel(['YES', 'NO'])).toBeNull()
  })

  it('names the first outcome for a non-Yes/No market', () => {
    expect(trackedOutcomeLabel(['Knicks', 'Celtics'])).toBe('Knicks')
  })

  it('is null for missing or malformed outcomes', () => {
    expect(trackedOutcomeLabel(undefined)).toBeNull()
    expect(trackedOutcomeLabel('["Yes","No"]')).toBeNull()
    expect(trackedOutcomeLabel([])).toBeNull()
  })
})

describe('marketLineName', () => {
  it('labels a plain link with the provider', () => {
    expect(marketLineName('Polymarket', false, null)).toBe('Polymarket')
  })

  it('flags inversion in the legend', () => {
    expect(marketLineName('Polymarket', true, null)).toBe('Polymarket, inverted')
  })

  it('names the tracked outcome for non-Yes/No markets', () => {
    expect(marketLineName('Polymarket', false, 'Knicks')).toBe('"Knicks" (Polymarket)')
  })
})

// daatan#2141
describe('marketDeadlineDeltaDays / marketDeadlineMismatch', () => {
  const deadline = '2026-12-09T00:00:00Z'

  it('returns market end − deadline in days', () => {
    expect(marketDeadlineDeltaDays('2026-12-31T00:00:00Z', deadline)).toBe(22)
    expect(marketDeadlineDeltaDays(new Date('2026-12-01T00:00:00Z'), new Date(deadline))).toBe(-8)
  })

  it('returns null when either date is missing or invalid', () => {
    expect(marketDeadlineDeltaDays(null, deadline)).toBeNull()
    expect(marketDeadlineDeltaDays('2026-12-31T00:00:00Z', undefined)).toBeNull()
    expect(marketDeadlineDeltaDays('not a date', deadline)).toBeNull()
    expect(marketDeadlineMismatch(null, deadline)).toBeNull()
  })

  it('treats exactly 3 days apart as the same deadline, and just over as a mismatch', () => {
    expect(marketDeadlineMismatch('2026-12-12T00:00:00Z', deadline)).toBeNull()
    expect(marketDeadlineMismatch('2026-12-06T00:00:00Z', deadline)).toBeNull()
    expect(marketDeadlineMismatch('2026-12-12T00:00:01Z', deadline)).toBe('later')
    expect(marketDeadlineMismatch('2026-12-05T23:59:59Z', deadline)).toBe('earlier')
  })
})

describe('marketDivergenceBound', () => {
  const deadline = '2026-12-09T00:00:00Z'
  const later = '2026-12-31T00:00:00Z'
  const earlier = '2026-11-20T00:00:00Z'

  it('ARRIVAL: later market is an upper bound, earlier a lower bound', () => {
    expect(marketDivergenceBound('ARRIVAL', deadline, later)).toBe('upper')
    expect(marketDivergenceBound('ARRIVAL', deadline, earlier)).toBe('lower')
  })

  it('SURVIVAL mirrors it: later market is a lower bound, earlier an upper bound', () => {
    expect(marketDivergenceBound('SURVIVAL', deadline, later)).toBe('lower')
    expect(marketDivergenceBound('SURVIVAL', deadline, earlier)).toBe('upper')
  })

  it('falls back to two-sided for same deadline, unknown direction or missing dates', () => {
    expect(marketDivergenceBound('ARRIVAL', deadline, '2026-12-11T00:00:00Z')).toBe('two-sided')
    expect(marketDivergenceBound('NONE', deadline, later)).toBe('two-sided')
    expect(marketDivergenceBound(null, deadline, later)).toBe('two-sided')
    expect(marketDivergenceBound(undefined, deadline, later)).toBe('two-sided')
    expect(marketDivergenceBound('ARRIVAL', null, later)).toBe('two-sided')
    expect(marketDivergenceBound('ARRIVAL', deadline, null)).toBe('two-sided')
  })
})

describe('marketDivergenceGap', () => {
  it('upper bound counts only ours above the market', () => {
    expect(marketDivergenceGap(94, 62, 'upper')).toBe(-32)
    expect(marketDivergenceGap(40, 70, 'upper')).toBe(30)
  })

  it('lower bound counts only ours below the market', () => {
    expect(marketDivergenceGap(94, 62, 'lower')).toBe(32)
    expect(marketDivergenceGap(40, 70, 'lower')).toBe(-30)
  })

  it('two-sided is the absolute gap', () => {
    expect(marketDivergenceGap(94, 62, 'two-sided')).toBe(32)
    expect(marketDivergenceGap(40, 70, 'two-sided')).toBe(30)
  })
})
