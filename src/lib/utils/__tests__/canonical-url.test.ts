/**
 * @jest-environment node
 */
import { describe, it, expect } from 'vitest'
import { canonicalKey } from '../canonical-url'

describe('canonicalKey', () => {
  it('strips www, tracking params, and fragments; lowercases host', () => {
    expect(canonicalKey('https://WWW.Reuters.com/a?utm_source=rss&id=5#top')).toBe('https://reuters.com/a?id=5')
  })

  it('treats www/non-www and tracking-only variants as the same key', () => {
    expect(canonicalKey('https://www.bbc.com/x?fbclid=abc')).toBe(canonicalKey('https://bbc.com/x'))
  })

  it('keeps non-tracking query params', () => {
    expect(canonicalKey('https://site.com/p?page=2')).toContain('page=2')
  })

  it('falls back to the raw string when unparseable', () => {
    expect(canonicalKey('not a url')).toBe('not a url')
  })
})
