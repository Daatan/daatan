import { describe, it, expect, beforeEach } from 'vitest'
import { getEstimate, recordDuration } from '@/lib/forecast-timing'

describe('forecast-timing', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns sensible defaults when nothing is stored', () => {
    expect(getEstimate('forecast-create')).toBe(5000)
    expect(getEstimate('forecast-publish')).toBe(1500)
  })

  it('blends a recorded duration toward the new sample via EWMA', () => {
    // prev 5000, sample 10000 → round(5000*0.6 + 10000*0.4) = 7000
    recordDuration('forecast-create', 10000)
    expect(getEstimate('forecast-create')).toBe(7000)
  })

  it('converges toward repeated samples over successive runs', () => {
    for (let i = 0; i < 20; i++) recordDuration('forecast-publish', 3000)
    expect(getEstimate('forecast-publish')).toBeGreaterThan(2900)
    expect(getEstimate('forecast-publish')).toBeLessThanOrEqual(3000)
  })

  it('ignores non-positive or non-finite samples', () => {
    recordDuration('forecast-create', 0)
    recordDuration('forecast-create', -5)
    recordDuration('forecast-create', Number.NaN)
    expect(getEstimate('forecast-create')).toBe(5000)
  })

  it('falls back to default when stored value is corrupt', () => {
    window.localStorage.setItem('daatan:timing:forecast-create', 'not-a-number')
    expect(getEstimate('forecast-create')).toBe(5000)
  })

  // daatan#1139 (bot runs) — client-calibrated step estimates for the admin
  // "Run now" progress panel.
  describe('bot-run keys', () => {
    it('returns sensible defaults when nothing is stored', () => {
      expect(getEstimate('bot-fetch')).toBe(3000)
      expect(getEstimate('bot-detect')).toBe(500)
      expect(getEstimate('bot-generate')).toBe(4000)
      expect(getEstimate('bot-stake')).toBe(1000)
    })

    it('blends a recorded duration toward the new sample via EWMA', () => {
      // prev 3000, sample 6000 → round(3000*0.6 + 6000*0.4) = 4200
      recordDuration('bot-fetch', 6000)
      expect(getEstimate('bot-fetch')).toBe(4200)
    })

    it('converges toward repeated samples over successive runs', () => {
      for (let i = 0; i < 20; i++) recordDuration('bot-generate', 2000)
      expect(getEstimate('bot-generate')).toBeGreaterThan(1900)
      // Integer rounding on each EWMA step can trap the sequence one ms above
      // the exact target instead of reaching it precisely (round(2000.6) = 2001,
      // itself a fixed point) — so allow that off-by-one rather than requiring 2000.
      expect(getEstimate('bot-generate')).toBeLessThanOrEqual(2001)
    })

    it('ignores non-positive or non-finite samples', () => {
      recordDuration('bot-stake', 0)
      recordDuration('bot-stake', -5)
      recordDuration('bot-stake', Number.NaN)
      expect(getEstimate('bot-stake')).toBe(1000)
    })

    it('falls back to default when stored value is corrupt', () => {
      window.localStorage.setItem('daatan:timing:bot-detect', 'not-a-number')
      expect(getEstimate('bot-detect')).toBe(500)
    })

    it('keeps each bot-run key independently calibrated', () => {
      recordDuration('bot-fetch', 10000)
      expect(getEstimate('bot-detect')).toBe(500)
      expect(getEstimate('bot-generate')).toBe(4000)
      expect(getEstimate('bot-stake')).toBe(1000)
    })
  })
})
