import { describe, it, expect } from 'vitest'
import {
  isInScopeCategory,
  passesVolumeFloor,
  applyIngestFilterPolicy,
  IN_SCOPE_CATEGORIES,
  VOLUME_FLOOR_USD,
  SERIES_CAP_N,
  type CatalogueCandidate,
} from '../market-catalogue-filter'

function candidate(overrides: Partial<CatalogueCandidate> = {}): CatalogueCandidate {
  return {
    category: 'politics',
    volumeUsd: 100_000,
    side: 'open',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

describe('isInScopeCategory', () => {
  it('accepts every category the census was measured against', () => {
    for (const c of IN_SCOPE_CATEGORIES) expect(isInScopeCategory(c)).toBe(true)
  })

  it('rejects an out-of-scope category', () => {
    expect(isInScopeCategory('sports')).toBe(false)
  })
})

describe('passesVolumeFloor', () => {
  it('uses the $1k floor for open markets', () => {
    expect(passesVolumeFloor(999, 'open')).toBe(false)
    expect(passesVolumeFloor(VOLUME_FLOOR_USD.open, 'open')).toBe(true)
  })

  it('uses the $50k floor for resolved markets', () => {
    expect(passesVolumeFloor(49_999, 'resolved')).toBe(false)
    expect(passesVolumeFloor(VOLUME_FLOOR_USD.resolved, 'resolved')).toBe(true)
  })

  it('does not apply the resolved floor to an open market with the same volume', () => {
    // $10k clears the open floor but would fail the resolved floor.
    expect(passesVolumeFloor(10_000, 'open')).toBe(true)
  })
})

describe('applyIngestFilterPolicy', () => {
  it('drops out-of-scope categories regardless of volume', () => {
    const result = applyIngestFilterPolicy([candidate({ category: 'sports', volumeUsd: 10_000_000 })])
    expect(result).toHaveLength(0)
  })

  it('drops in-scope markets under the volume floor', () => {
    const result = applyIngestFilterPolicy([candidate({ side: 'open', volumeUsd: 500 })])
    expect(result).toHaveLength(0)
  })

  it('keeps an in-scope market that clears its side floor', () => {
    const c = candidate({ side: 'resolved', volumeUsd: 60_000 })
    expect(applyIngestFilterPolicy([c])).toEqual([c])
  })

  it('leaves a one_off market uncapped', () => {
    const c = candidate({ seriesFrequency: 'one_off', seriesId: 'evt-1' })
    expect(applyIngestFilterPolicy([c])).toEqual([c])
  })

  it('leaves a market with no series info uncapped', () => {
    const c = candidate()
    expect(applyIngestFilterPolicy([c])).toEqual([c])
  })

  it('caps a templated series to the N most recent instances', () => {
    const seriesId = 'KXBTCD'
    const instances = Array.from({ length: SERIES_CAP_N + 5 }, (_, i) =>
      candidate({
        seriesFrequency: 'hourly',
        seriesId,
        volumeUsd: 5_000,
        createdAt: new Date(Date.UTC(2026, 8, 1, i)),
      })
    )

    const result = applyIngestFilterPolicy(instances)

    expect(result).toHaveLength(SERIES_CAP_N)
    const keptTimes = result.map(r => r.createdAt.getTime()).sort((a, b) => b - a)
    const expectedTimes = instances
      .map(i => i.createdAt.getTime())
      .sort((a, b) => b - a)
      .slice(0, SERIES_CAP_N)
    expect(keptTimes).toEqual(expectedTimes)
  })

  it('applies the volume floor before the series cap, per #1639', () => {
    // 20 hourly instances of the same series, all under the $1k open floor: the cap
    // alone would keep 10, but the floor must remove all of them first.
    const instances = Array.from({ length: 20 }, (_, i) =>
      candidate({
        seriesFrequency: 'hourly',
        seriesId: 'KXETH',
        side: 'open',
        volumeUsd: 50,
        createdAt: new Date(Date.UTC(2026, 8, 1, i)),
      })
    )

    expect(applyIngestFilterPolicy(instances)).toHaveLength(0)
  })

  it('caps each series independently', () => {
    const seriesA = Array.from({ length: SERIES_CAP_N + 2 }, (_, i) =>
      candidate({ seriesFrequency: 'daily', seriesId: 'A', createdAt: new Date(Date.UTC(2026, 8, 1, i)) })
    )
    const seriesB = Array.from({ length: SERIES_CAP_N + 2 }, (_, i) =>
      candidate({ seriesFrequency: 'daily', seriesId: 'B', createdAt: new Date(Date.UTC(2026, 8, 1, i)) })
    )

    const result = applyIngestFilterPolicy([...seriesA, ...seriesB])

    expect(result.filter(r => r.seriesId === 'A')).toHaveLength(SERIES_CAP_N)
    expect(result.filter(r => r.seriesId === 'B')).toHaveLength(SERIES_CAP_N)
  })
})
