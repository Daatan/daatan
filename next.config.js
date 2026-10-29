const { version } = require('./package.json')
const { HTML_LIMITED_BOT_UA_RE } = require('next/dist/shared/lib/router/utils/html-bots')
const createNextIntlPlugin = require('next-intl/plugin')
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Prefer build-arg / env so Docker/CI can bake the correct version (e.g. from tag v1.4.10 -> 1.4.10)
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || version

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // /predictions was the old route name — permanently redirect to /forecasts
      {
        source: '/predictions',
        destination: '/forecasts',
        permanent: true,
      },
      {
        source: '/predictions/:id',
        destination: '/forecasts/:id',
        permanent: true,
      },
      // The in-app elections matrix was superseded by the standalone
      // elections.daatan.com app (Daatan/elections) and removed (daatan#2011).
      {
        source: '/elections/:path*',
        destination: 'https://elections.daatan.com/:path*',
        permanent: true,
      },
      {
        source: '/:locale(en|he|ru|eo)/elections/:path*',
        destination: 'https://elections.daatan.com/:path*',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      // public/.well-known/assetlinks.json (Android TWA Digital Asset Links)
      // is otherwise unreachable -- Next's static file server 404s any
      // public/ path with a dot-prefixed segment. Route it to an API
      // handler instead.
      {
        source: '/.well-known/assetlinks.json',
        destination: '/api/well-known/assetlinks',
      },
    ]
  },
  output: 'standalone',
  reactStrictMode: true,
  // The dedicated typecheck/lint CI jobs already gate every PR on the same
  // commit, seconds before this build step runs — re-running type-checking here
  // is pure duplicate work (daatan#1584). Next 16 no longer lints during build.
  typescript: {
    ignoreBuildErrors: true,
  },
  cacheComponents: true,
  // Routes with a loading.tsx stream metadata (title, canonical, robots, hreflang) into
  // <body> for any UA not matched here. Next's default list leaves out Googlebot and every
  // AI crawler, and GSC showed Google ignoring those body-placed canonicals (daatan#2055).
  // This replaces the default, so extend its regex rather than restating it.
  htmlLimitedBots: new RegExp(
    `${HTML_LIMITED_BOT_UA_RE.source}|Googlebot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|PerplexityBot|CCBot|Amazonbot`,
    'i',
  ),
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // Ensure next-auth is properly bundled
  transpilePackages: ['next-auth'],
  // Keep Node.js-only packages out of the Node.js server bundle (avoids re-bundling)
  serverExternalPackages: ['pg', 'pg-pool', 'pg-protocol', 'pg-types', '@prisma/adapter-pg'],
  // Allow external images from Google OAuth
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },
}

module.exports = withBundleAnalyzer(withNextIntl(nextConfig))
