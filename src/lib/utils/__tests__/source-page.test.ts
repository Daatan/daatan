import { describe, it, expect } from 'vitest'
import { articleHost, sourcePagePath } from '../source-page'

describe('sourcePagePath (#2298)', () => {
  it('prefers the resolved outlet name', () => {
    expect(sourcePagePath('Ynet', 'https://www.ynet.co.il/news/1')).toBe('/sources/Ynet')
  })

  it('falls back to the article host, without www', () => {
    expect(sourcePagePath(null, 'https://www.tomshardware.com/tech/x')).toBe('/sources/tomshardware.com')
    expect(sourcePagePath('  ', 'https://theverge.com/a')).toBe('/sources/theverge.com')
  })

  it('encodes the name', () => {
    expect(sourcePagePath('Amit Segal')).toBe('/sources/Amit%20Segal')
    expect(sourcePagePath('some/outlet')).toBe('/sources/some%2Foutlet')
  })

  it('is null with neither a name nor a parseable URL', () => {
    expect(sourcePagePath(null, 'not a url')).toBeNull()
    expect(sourcePagePath(undefined)).toBeNull()
  })
})

describe('articleHost', () => {
  it('lowercases and strips www', () => {
    expect(articleHost('https://WWW.Reuters.com/world')).toBe('reuters.com')
  })
  it('is null for junk', () => {
    expect(articleHost('')).toBeNull()
    expect(articleHost('reuters')).toBeNull()
  })
})
