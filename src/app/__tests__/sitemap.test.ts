import { describe, it, expect } from 'vitest'
import { isSitemapEligible } from '../sitemap'

function prediction(overrides: {
  status?: string
  detailsText?: string | null
  commitments?: number
}) {
  return {
    status: overrides.status ?? 'ACTIVE',
    detailsText: overrides.detailsText ?? null,
    _count: { commitments: overrides.commitments ?? 0 },
  }
}

describe('isSitemapEligible', () => {
  it('excludes a bare ACTIVE forecast: no commitments, no detailsText', () => {
    expect(isSitemapEligible(prediction({}))).toBe(false)
  })

  it('excludes a bare PENDING forecast with only whitespace detailsText', () => {
    expect(isSitemapEligible(prediction({ status: 'PENDING', detailsText: '   ' }))).toBe(false)
  })

  it('excludes detailsText under the 40-char threshold', () => {
    expect(isSitemapEligible(prediction({ detailsText: 'short context' }))).toBe(false)
  })

  it('includes detailsText at/above the 40-char threshold (trimmed)', () => {
    const detailsText = '  ' + 'a'.repeat(40) + '  '
    expect(isSitemapEligible(prediction({ detailsText }))).toBe(true)
  })

  it('includes a forecast with at least one commitment regardless of detailsText', () => {
    expect(isSitemapEligible(prediction({ commitments: 1 }))).toBe(true)
  })

  it('always includes RESOLVED_CORRECT, even with zero commitments and no detailsText', () => {
    expect(isSitemapEligible(prediction({ status: 'RESOLVED_CORRECT' }))).toBe(true)
  })

  it('always includes RESOLVED_WRONG, even with zero commitments and no detailsText', () => {
    expect(isSitemapEligible(prediction({ status: 'RESOLVED_WRONG' }))).toBe(true)
  })
})
