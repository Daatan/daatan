import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { HomeSeenMarker } from '../HomeSeenMarker'
import { HOME_SEEN_COOKIE } from '@/lib/first-visit'

// jsdom keeps an expired cookie as an empty value, so read the value instead of testing presence.
const readCookie = () =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${HOME_SEEN_COOKIE}=`))
    ?.slice(HOME_SEEN_COOKIE.length + 1)

describe('HomeSeenMarker', () => {
  it('sets the home-seen cookie when mounted', () => {
    document.cookie = `${HOME_SEEN_COOKIE}=; Max-Age=0; Path=/`
    expect(readCookie() || undefined).toBeUndefined()
    render(<HomeSeenMarker />)
    expect(readCookie()).toBe('1')
  })
})
