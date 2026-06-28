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
      disallow: [
        '/admin/',
        '/api/',
        '/settings/',
        '/auth/',
        '/notifications/',
        '/commitments/',
        '/create/',
        '/forecasts/new/',
        '/forecasts/express/',
        '/forecasts/*/edit/',
        '/retroanalysis/',
        // Internal architecture docs served as static HTML (also carry a
        // noindex meta tag) — not indexable content.
        '/docs/',
        // NOTE: the OG image routes (/opengraph-image, /*/opengraph-image) are
        // intentionally NOT disallowed. They return 200 image/png, so Google treats
        // them as image resources (not soft-404 pages); blocking them only filled
        // Search Console's "Blocked by robots.txt" report with ~one entry per
        // forecast×locale (every page's og:image points at one) for no benefit.
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
