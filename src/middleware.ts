import NextAuth from "next-auth"
import authConfig from "./auth.config"
import { NextResponse } from "next/server"
import { HOME_SEEN_COOKIE, homeV5RedirectPath } from "./lib/first-visit"

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const isAuth = !!req.auth
  const pathname = req.nextUrl.pathname

  // Admin routes require ADMIN role
  if (pathname.startsWith('/admin')) {
    if (!isAuth) {
      return NextResponse.redirect(new URL('/auth/signin', req.url))
    }
    if (req.auth?.user?.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  // First visit: anonymous visitors without the cookie land on the home-v5 page (#1840).
  const homeTarget = homeV5RedirectPath({
    pathname,
    searchParams: req.nextUrl.searchParams,
    hasHomeSeenCookie: req.cookies.has(HOME_SEEN_COOKIE),
    isAuthenticated: isAuth,
    // Read directly: this runs on the Edge, where the validated `@/env` module is not available.
    selfHosted: process.env.DAATAN_EDITION === 'self_hosted',
  })

  // Forward pathname to server components so the root layout can set
  // <html lang> from the URL prefix (/he, /ru, /eo) instead of cookies.
  const requestHeaders = new Headers(req.headers)

  if (homeTarget) {
    // Served in place (rewrite, not a redirect): one request fewer for a first visit, and crawlers
    // get a 200 at "/" instead of a temporary redirect. The page's own canonical stays /home-v5.
    requestHeaders.set('x-pathname', homeTarget)
    const url = req.nextUrl.clone()
    url.pathname = homeTarget
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  }

  requestHeaders.set('x-pathname', pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // og:image generator routes return 200 image/png, never HTML — they exist
  // only so <meta property="og:image"> has something to point at. Googlebot
  // still crawls them as page candidates (every forecast/profile page links
  // one), then rejects them, which was piling up as "Crawled - currently not
  // indexed / Failed" in Search Console. X-Robots-Tag works on any content
  // type, unlike a robots.txt Disallow: it moves these to the clean
  // "Excluded by noindex tag" bucket without needing a Googlebot-specific
  // robots.txt block (which would also require duplicating every other
  // Disallow rule into that block, per RFC 9309's non-merging UA groups),
  // and social-preview crawlers fetching the raw image bytes ignore it.
  if (pathname.endsWith('/opengraph-image')) {
    response.headers.set('X-Robots-Tag', 'noindex')
  }

  return response
})

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)',
  ],
}
