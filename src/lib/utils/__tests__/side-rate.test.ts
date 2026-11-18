import { describe, it, expect } from 'vitest'
import { compareSideRate } from '../side-rate'

describe('compareSideRate (#2231)', () => {
  const r = (sideTaken: number | null, sideTotal: number | null) => ({ sideTaken, sideTotal })

  it('orders by rate, then by sample size, rows without a value last', () => {
    const rows = [r(null, null), r(1, 3), r(2, 6), r(1, 1), r(0, 5), {}]
    expect([...rows].sort((a, b) => compareSideRate(a, b))).toEqual([r(1, 1), r(2, 6), r(1, 3), r(0, 5), r(null, null), {}])
  })

  it('reverses rate and sample size when ascending, but keeps rows without a value last', () => {
    const rows = [r(null, null), r(3, 4), r(2, 8), r(1, 4)]
    expect([...rows].sort((a, b) => compareSideRate(a, b, 'asc'))).toEqual([r(1, 4), r(2, 8), r(3, 4), r(null, null)])
  })

  it('treats a zero denominator as no value', () => {
    expect(compareSideRate(r(0, 0), r(0, 3))).toBeGreaterThan(0)
  })
})
