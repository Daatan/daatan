import type { MetadataRoute } from 'next'
import { getAppUrl, shouldIndex } from '@/lib/branding'

export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getAppUrl()

  // Non-indexable (any non-prod SaaS env, or any self-hosted instance) → block all.
  if (!shouldIndex()) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // No trailing slash: Disallow is a prefix match (RFC 9309), and
      // trailingSlash is unset (defaults false) — the pages below render at
      // the bare path (e.g. /settings, not /settings/), so a '/settings/'
      // rule blocks only subpaths and leaks the page itself. The bare form
      // still covers subpaths too, so this is strictly broader, not looser.
      disallow: [
        '/admin',
        '/api/',
        '/settings',
        '/auth/',
        '/notifications',
        '/commitments',
        '/create',
        '/forecasts/new',
        '/forecasts/express',
        '/forecasts/*/edit',
        '/retroanalysis',
        // Internal architecture docs served as static HTML (also carry a
        // noindex meta tag) — not indexable content.
        '/docs/',
        // Telegram-bot-linked explainer (daatan#1313) — also carries page-level
        // `robots: { index: false }` metadata; not indexable content.
        '/help/',
        // NOTE: the OG image routes (/opengraph-image, /*/opengraph-image) are
        // intentionally NOT disallowed here. Blocking them via robots.txt would
        // require duplicating every other Disallow rule into a Googlebot-specific
        // user-agent block (RFC 9309: UA groups don't merge with the wildcard
        // group), and social-preview crawlers fetching the raw image bytes would
        // still be fine either way. Instead, src/middleware.ts sets
        // `X-Robots-Tag: noindex` on every /opengraph-image response — that
        // excludes them from the index cleanly ("Excluded by noindex tag") without
        // touching robots.txt at all, and works regardless of content-type.
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
