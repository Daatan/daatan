import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { env } from '@/env'
import { VERSION } from '@/lib/version'
import { getAppName, getAppUrl } from '@/lib/branding'
import { aiFeaturesEnabled, aiResearchEnabled, externalMarketsEnabled } from '@/lib/capabilities'
import { isOpenSignupEnabled } from '@/lib/auth/access'

/**
 * GET /api/admin/about — operator self-diagnosis. Reports the edition, version,
 * branding, and which capabilities/integrations are configured. Booleans only;
 * never returns secret values.
 */
export const GET = withAuth(async () => {
  return NextResponse.json({
    version: VERSION,
    edition: env.DAATAN_EDITION,
    appName: getAppName(),
    appUrl: getAppUrl(),
    capabilities: {
      ai: aiFeaturesEnabled(),
      aiResearch: aiResearchEnabled(),
      externalMarkets: externalMarketsEnabled(),
    },
    auth: {
      google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      oidc: !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET),
      adminEmails: !!env.OIDC_ADMIN_EMAILS,
      domainAllowlist: !!env.ALLOWED_EMAIL_DOMAINS,
      openSignup: isOpenSignupEnabled(env.DAATAN_EDITION, env.SELF_HOST_OPEN_SIGNUP),
    },
    storage: {
      driver: env.STORAGE_DRIVER ?? 's3',
    },
    integrations: {
      gemini: !!env.GEMINI_API_KEY,
      ollama: !!process.env.OLLAMA_BASE_URL,
      oracle: !!(env.ORACLE_URL && env.ORACLE_API_KEY),
      email: !!env.EMAIL_FROM,
      telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      newsIndexer: !!(env.NEWS_INDEXER_URL && env.NEWS_INDEXER_API_KEY),
    },
  })
}, { roles: ['ADMIN'] })
