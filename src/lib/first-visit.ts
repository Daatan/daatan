/**
 * First-visit routing for the home-v5 page (#1840).
 *
 * Anonymous visitors without the "feed seen" cookie who open the site root are sent to the
 * home-v5 page. Opening the forecasts page sets the cookie (FeedSeenMarker, client side, so link
 * prefetches do not count), after which the root shows the forecast feed again. Pure helpers so the Edge middleware stays thin and testable.
 */

export const FEED_SEEN_COOKIE = 'daatan_feed_seen'
export const FEED_SEEN_MAX_AGE = 60 * 60 * 24 * 365

const ROOT = /^\/(he|ru|eo)?\/?$/
// Filtered feed links (shared or bookmarked) must keep landing on the feed.
const FEED_PARAMS = ['status', 'tags', 'sortBy', 'q', 'page']

export interface RootRedirectInput {
  pathname: string
  searchParams: URLSearchParams
  hasFeedSeenCookie: boolean
  isAuthenticated: boolean
  selfHosted: boolean
}

/** Pathname to redirect to (without query), or null to serve the page as usual. */
export function homeV5RedirectPath({
  pathname,
  searchParams,
  hasFeedSeenCookie,
  isAuthenticated,
  selfHosted,
}: RootRedirectInput): string | null {
  if (selfHosted || isAuthenticated || hasFeedSeenCookie) return null
  const m = ROOT.exec(pathname)
  if (!m) return null
  if (FEED_PARAMS.some((p) => searchParams.has(p))) return null
  return m[1] ? `/${m[1]}/home-v5` : '/home-v5'
}
