/**
 * First-visit routing for the home-v5 page (#1840).
 *
 * Anonymous visitors without the "home seen" cookie who open the site root are sent to the
 * home-v5 page (served in place by a middleware rewrite, no redirect), which sets the cookie
 * (HomeSeenMarker, client side, so link prefetches do not
 * count), after which the root shows the forecast feed again. The cookie is new on purpose: users
 * who had visited the feed before home-v5 existed still see the page once. Pure helpers so the Edge middleware stays thin and testable.
 */

export const HOME_SEEN_COOKIE = 'daatan_home_v5_seen'
export const HOME_SEEN_MAX_AGE = 60 * 60 * 24 * 365

const ROOT = /^\/(he|ru|eo)?\/?$/
// Filtered feed links (shared or bookmarked) must keep landing on the feed.
const FEED_PARAMS = ['status', 'tags', 'sortBy', 'q', 'page']

export interface RootRedirectInput {
  pathname: string
  searchParams: URLSearchParams
  hasHomeSeenCookie: boolean
  isAuthenticated: boolean
  selfHosted: boolean
}

/** Pathname of the home-v5 page to serve at the root (without query), or null to serve the page as usual. */
export function homeV5RedirectPath({
  pathname,
  searchParams,
  hasHomeSeenCookie,
  isAuthenticated,
  selfHosted,
}: RootRedirectInput): string | null {
  if (selfHosted || isAuthenticated || hasHomeSeenCookie) return null
  const m = ROOT.exec(pathname)
  if (!m) return null
  if (FEED_PARAMS.some((p) => searchParams.has(p))) return null
  return m[1] ? `/${m[1]}/home-v5` : '/home-v5'
}
