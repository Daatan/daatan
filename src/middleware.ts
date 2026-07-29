import NextAuth from "next-auth"
import authConfig from "./auth.config"
import { NextResponse } from "next/server"

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

  // Forward pathname to server components so the root layout can set
  // <html lang> from the URL prefix (/he, /ru, /eo) instead of cookies.
  const requestHeaders = new Headers(req.headers)
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
