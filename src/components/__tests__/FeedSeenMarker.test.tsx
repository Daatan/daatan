import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { FeedSeenMarker } from '../FeedSeenMarker'
import { FEED_SEEN_COOKIE } from '@/lib/first-visit'

describe('FeedSeenMarker', () => {
  beforeEach(() => {
    document.cookie = `${FEED_SEEN_COOKIE}=; Max-Age=0; Path=/`
  })

  it('sets the feed-seen cookie when mounted', () => {
    expect(document.cookie).not.toContain(FEED_SEEN_COOKIE)
    render(<FeedSeenMarker />)
    expect(document.cookie).toContain(`${FEED_SEEN_COOKIE}=1`)
  })
})
