import { describe, it, expect } from 'vitest'
import { DAY_MS, MIN_ZOOM_MS, presetApplies, presetDomain, tickTimestamps, zoomTo } from '../chart-zoom'

const full: [number, number] = [0, 40 * DAY_MS]

describe('chart-zoom (mirrors elections combined-chart)', () => {
  it('zoomTo orders, clamps to the data, and rejects a selection too narrow to be deliberate', () => {
    expect(zoomTo(full, 10 * DAY_MS, 5 * DAY_MS)).toEqual([5 * DAY_MS, 10 * DAY_MS])
    expect(zoomTo(full, -DAY_MS, 2 * DAY_MS)).toEqual([0, 2 * DAY_MS])
    expect(zoomTo(full, DAY_MS, DAY_MS + MIN_ZOOM_MS - 1)).toBeNull()
  })

  it('presetDomain anchors to the data’s right edge; presetApplies only when narrower than the data', () => {
    expect(presetDomain(full, 7)).toEqual([33 * DAY_MS, 40 * DAY_MS])
    expect(presetDomain([0, 3 * DAY_MS], 7)).toEqual([0, 3 * DAY_MS])
    expect(presetApplies(full, 30)).toBe(true)
    expect(presetApplies([0, 8 * DAY_MS], 30)).toBe(false)
  })

  it('tickTimestamps spaces ticks strictly inside the domain and is empty on a point', () => {
    expect(tickTimestamps(0, 4, 3)).toEqual([1, 2, 3])
    expect(tickTimestamps(5, 5, 3)).toEqual([])
  })
})
