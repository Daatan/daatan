import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FeedSeenMarker } from '../FeedSeenMarker'
import { FEED_SEEN_COOKIE } from '@/lib/first-visit'

// jsdom keeps an expired cookie as an empty value, so read the value instead of testing presence.
const readCookie = () =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${FEED_SEEN_COOKIE}=`))
    ?.slice(FEED_SEEN_COOKIE.length + 1)

describe('FeedSeenMarker', () => {
  it('sets the feed-seen cookie when mounted', () => {
    document.cookie = `${FEED_SEEN_COOKIE}=; Max-Age=0; Path=/`
    expect(readCookie() || undefined).toBeUndefined()
    render(<FeedSeenMarker />)
    expect(readCookie()).toBe('1')
  })
})
