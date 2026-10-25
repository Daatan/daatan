import { describe, it, expect } from 'vitest'
import { isSitemapEligible, sitemapLastModified, SITEMAP_TAG_WHERE } from '../sitemap'
import { VISIBLE_TAG_PREDICTION_WHERE } from '@/lib/services/tag'

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

describe('sitemapLastModified', () => {
  const updatedAt = new Date('2026-01-01')
  const resolvedAt = new Date('2026-06-15')

  it('uses updatedAt for a non-resolved forecast', () => {
    expect(sitemapLastModified({ status: 'ACTIVE', updatedAt, resolvedAt: null })).toBe(updatedAt)
  })

  it('uses resolvedAt for a RESOLVED_CORRECT forecast', () => {
    expect(sitemapLastModified({ status: 'RESOLVED_CORRECT', updatedAt, resolvedAt })).toBe(resolvedAt)
  })

  it('uses resolvedAt for a RESOLVED_WRONG forecast', () => {
    expect(sitemapLastModified({ status: 'RESOLVED_WRONG', updatedAt, resolvedAt })).toBe(resolvedAt)
  })

  it('falls back to updatedAt for a resolved forecast missing resolvedAt', () => {
    expect(sitemapLastModified({ status: 'RESOLVED_CORRECT', updatedAt, resolvedAt: null })).toBe(updatedAt)
  })
})

describe('SITEMAP_TAG_WHERE', () => {
  // The tag page noindexes itself when it has no active public forecast; listing such a tag
  // in the sitemap puts it in GSC's "Excluded by 'noindex' tag" bucket (daatan#2028).
  it('lists a tag only if it has a forecast the tag page would show', () => {
    expect(SITEMAP_TAG_WHERE).toEqual({ predictions: { some: VISIBLE_TAG_PREDICTION_WHERE } })
    expect(VISIBLE_TAG_PREDICTION_WHERE).toEqual({ status: 'ACTIVE', isPublic: true })
  })
})
