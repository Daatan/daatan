import { describe, it, expect } from 'vitest'
import { homeV5RedirectPath } from '../first-visit'

const base = {
  searchParams: new URLSearchParams(),
  hasFeedSeenCookie: false,
  isAuthenticated: false,
  selfHosted: false,
}

describe('homeV5RedirectPath', () => {
  it.each([
    ['/', '/home-v5'],
    ['/he', '/he/home-v5'],
    ['/ru/', '/ru/home-v5'],
    ['/eo', '/eo/home-v5'],
  ])('sends a first-time anonymous visitor from %s to %s', (pathname, target) => {
    expect(homeV5RedirectPath({ ...base, pathname })).toBe(target)
  })

  it('does nothing once the feed has been seen', () => {
    expect(homeV5RedirectPath({ ...base, pathname: '/', hasFeedSeenCookie: true })).toBeNull()
  })

  it('does nothing for signed-in users', () => {
    expect(homeV5RedirectPath({ ...base, pathname: '/', isAuthenticated: true })).toBeNull()
  })

  it('does nothing on self-hosted installs', () => {
    expect(homeV5RedirectPath({ ...base, pathname: '/', selfHosted: true })).toBeNull()
  })

  it('keeps filtered feed links on the feed', () => {
    for (const q of ['status=RESOLVED', 'tags=ai', 'sortBy=cu', 'q=bitcoin', 'page=2']) {
      expect(homeV5RedirectPath({ ...base, pathname: '/', searchParams: new URLSearchParams(q) })).toBeNull()
    }
  })

  it('leaves tracking parameters alone', () => {
    expect(homeV5RedirectPath({ ...base, pathname: '/', searchParams: new URLSearchParams('utm_source=x') })).toBe('/home-v5')
  })

  it.each(['/forecasts', '/home-v5', '/he/about', '/forecasts/abc', '/hex', '/api/health'])('ignores %s', (pathname) => {
    expect(homeV5RedirectPath({ ...base, pathname })).toBeNull()
  })
})
