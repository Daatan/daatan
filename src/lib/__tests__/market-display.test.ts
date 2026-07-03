import { describe, it, expect } from 'vitest'
import {
  marketDisplayProbability,
  trackedOutcomeLabel,
  marketLineName,
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
    expect(marketLineName('Polymarket', false, null)).toBe('Market (Polymarket)')
  })

  it('flags inversion in the legend', () => {
    expect(marketLineName('Polymarket', true, null)).toBe('Market (Polymarket, inverted)')
  })

  it('names the tracked outcome for non-Yes/No markets', () => {
    expect(marketLineName('Polymarket', false, 'Knicks')).toBe('Market: "Knicks" (Polymarket)')
  })
})
