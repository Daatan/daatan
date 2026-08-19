import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    // Database
    DATABASE_URL: z.string().url(),

    // NextAuth.js
    NEXTAUTH_URL: z.string().url(),
    NEXTAUTH_SECRET: z
      .string()
      .min(32, 'Must be at least 32 characters long')
      .refine(
        (val) => !['changeme', 'placeholder', 'dummy', 'development', 'example', 'your-secret', 'test-secret'].some((s) => val.toLowerCase().includes(s)),
        'Contains placeholder text - use a real secret'
      )
      .refine(
        (val) => /[^a-zA-Z\s-]/.test(val),
        'Looks like plain text - must contain numbers or special characters'
      ),

    // Google OAuth — optional. Required for the SaaS edition (daatan.com); a
    // self-hosted install authenticates via OIDC/SAML (Phase 1) or credentials.
    // When both are present, the Google provider is registered (see auth.config.ts).
    GOOGLE_CLIENT_ID: z
      .string()
      .regex(/\.apps\.googleusercontent\.com$/, 'Must end with .apps.googleusercontent.com')
      .optional(),
    GOOGLE_CLIENT_SECRET: z
      .string()
      .min(10, 'Too short to be valid')
      .optional(),

    // Deployment edition. 'saas' (default) = daatan.com behavior, unchanged.
    // 'self_hosted' = single-org install; gates open-signup defaults, SEO
    // indexing, admin bootstrap and licensing in later phases.
    DAATAN_EDITION: z.enum(['saas', 'self_hosted']).default('saas'),

    // Public base URL of this install. Falls back to NEXTAUTH_URL when unset.
    // Consumed for canonical/SEO/branding from Phase 3 onward.
    APP_URL: z.string().url().optional(),

    // White-label branding (self-host). Falls back to Daatan defaults when unset.
    APP_NAME: z.string().min(1).optional(),
    APP_LOGO_URL: z.string().url().optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    CONTACT_EMAIL: z.string().min(1).optional(),

    // Object storage for uploads (avatars). 's3' (default) preserves current
    // prod behavior; 'local'/'minio' are wired by the storage abstraction
    // (follow-up PR). UPLOADS_BUCKET_NAME / S3_ENDPOINT used by the s3/minio drivers.
    STORAGE_DRIVER: z.enum(['s3', 'local', 'minio']).default('s3'),
    STORAGE_LOCAL_PATH: z.string().min(1).optional(),
    S3_ENDPOINT: z.string().url().optional(),
    UPLOADS_BUCKET_NAME: z.string().min(1).optional(),

    // Enterprise SSO (self-host) — generic OIDC (Azure AD / Okta / Keycloak /
    // Google Workspace). The provider is registered when all three are set.
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    // Sign-in button label for the OIDC provider (defaults to "SSO").
    OIDC_PROVIDER_NAME: z.string().min(1).optional(),
    // Comma/space-separated emails promoted to ADMIN on sign-in (admin bootstrap).
    OIDC_ADMIN_EMAILS: z.string().min(1).optional(),

    // Access gating (self-host). Open public credentials signup — only consulted
    // for the self_hosted edition, where signup is closed by default; set to
    // 'true' to re-open it. SaaS is always open regardless of this value.
    SELF_HOST_OPEN_SIGNUP: z.enum(['true', 'false']).optional(),
    // Comma/space-separated email domains permitted to sign up / sign in (any
    // provider). When unset, no domain restriction (the SaaS default).
    ALLOWED_EMAIL_DOMAINS: z.string().min(1).optional(),

    // Optional add-on features, OFF BY DEFAULT for the self_hosted edition (SaaS
    // is always on). AI = Oracle co-forecaster + web/news search + LLM estimates
    // (Analyze, Express, Guess Chances, AI extract/tag-suggest). External markets
    // = Polymarket/Kalshi import + suggest-similar. Opt in per gate via 'true'.
    ENABLE_AI_FEATURES: z.enum(['true', 'false']).optional(),
    ENABLE_EXTERNAL_MARKETS: z.enum(['true', 'false']).optional(),

    // Optional / Other
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NEXTAUTH_DEBUG: z.enum(['true', 'false']).optional(),

    // Which deployed instance this is — set at container RUNTIME (docker-compose
    // `environment:` / blue-green-deploy.sh -e APP_ENV=..., not a build arg), so
    // it reads correctly even though staging and production run the same
    // promoted Docker image. This is the one to use for any staging-vs-production
    // runtime behavior (indexability, GA property, email redirect gating, debug
    // logging, etc). A build-time NEXT_PUBLIC_* var can never distinguish the two
    // — it is frozen to whatever the single shared image was built with (the
    // removed NEXT_PUBLIC_ENV was exactly that trap; see PR #1141's issue).
    APP_ENV: z.enum(['development', 'staging', 'next', 'production']).default('development'),
    
    // AI / Analytics
    // Gemini Developer API key. No longer supplied to Daatan's own SaaS containers
    // (#1472) — production runs Google through Vertex, below. Kept in the schema
    // because it is a first-class *self-host* LLM option: a self-hoster has no GCP
    // service account, and an AI Studio key is the easy path (see `hasLLM()` in
    // capabilities.ts, and EMBEDDINGS.md for the embedding side).
    GEMINI_API_KEY: z.string().min(1).optional(),
    // Gemini via Vertex AI (#1472) — the production Google leg, for both LLM calls
    // and embeddings. All three of PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY must be set
    // to enable it (LOCATION defaults); `vertexEnv()` is all-or-nothing, so a
    // partial set disables the leg outright rather than half-configuring it. Vertex
    // stays on GCP Postpay and draws the credits billing account directly, which is
    // what removes the prepaid-balance outage mode the Developer API's forced
    // Prepay migration introduces.
    GOOGLE_VERTEX_PROJECT_ID: z.string().min(1).optional(),
    GOOGLE_VERTEX_LOCATION: z.string().min(1).default('global'),
    GOOGLE_VERTEX_CLIENT_EMAIL: z.string().email().optional(),
    GOOGLE_VERTEX_PRIVATE_KEY: z.string().min(1).optional(),
    // LLM providers for the self-host edition. Configuring ANY of these turns on
    // AI features (Express, Guess, etc.) — the key is the opt-in. OpenRouter is
    // the easy default (one key, many models). OLLAMA_BASE_URL = a local LLM.
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENROUTER_MODEL: z.string().min(1).optional(),
    OLLAMA_BASE_URL: z.string().url().optional(),
    GA_MEASUREMENT_ID: z.string().startsWith('G-').optional(),

    // Telegram notifications
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_CHAT_ID: z.string().min(1).optional(),
    // Secret token for the /rollback webhook (Telegram setWebhook secret_token).
    // The rollback route fails closed without it — see api/telegram/rollback.
    TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),

    // Web Push (VAPID)
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),

    // Bot runner / cron shared secret
    BOT_RUNNER_SECRET: z.string().min(1).optional(),

    // Temporal-clock requote cron hard kill switch. The archetype allowlist
    // that actually gates behavior is sent per-request by the GitHub Actions
    // workflow (a repo variable, flippable without a deploy); this env var is
    // the server-side backstop that overrides whatever the request says.
    TEMPORAL_CLOCK_DISABLED: z.enum(['true', 'false']).optional(),

    // Bot system limits
    MAX_BOTS: z.coerce.number().default(50),

    // Oracle API — TruthMachine probability estimates
    ORACLE_URL: z.string().url().optional(),
    ORACLE_API_KEY: z.string().min(1).optional(),

    // IndexNow — instant Bing/Yandex indexing on publish
    INDEXNOW_KEY: z.string().min(1).optional(),

    // Google Indexing API — direct ping to Google on publish/re-slug.
    // Both must be set to enable; no-op otherwise. The service account must be
    // added as an owner of the property in Google Search Console.
    GOOGLE_INDEXING_CLIENT_EMAIL: z.string().email().optional(),
    GOOGLE_INDEXING_PRIVATE_KEY: z.string().min(1).optional(),

    // News-indexer integration
    NEWS_INDEXER_SECRET: z.string().min(1).optional(),  // inbound: news-indexer → Daatan
    NEWS_INDEXER_URL: z.string().url().optional(),      // outbound: Daatan → news-indexer
    NEWS_INDEXER_API_KEY: z.string().min(1).optional(), // outbound: api key for news-indexer

    // AI panel grounded-indexer scope (docs/LASSO.md §9a): tag slug whose forecasts get
    // the news-fed grounded twins. Unset = grounding off; also needs NEWS_INDEXER_URL/KEY.
    AI_PANEL_GROUNDED_TAG: z.string().min(1).optional(),

    // Telegram — prod-only "clean" channel for high-signal events/alarms.
    // Falls back to TELEGRAM_CHAT_ID (the noisy channel) when unset.
    TELEGRAM_CLEAN_CHAT_ID: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_APP_VERSION: z.string().optional(),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  },
  // If you're using Next.js < 13.4.4, you'll need to specify the runtimeEnv manually
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    DAATAN_EDITION: process.env.DAATAN_EDITION,
    APP_URL: process.env.APP_URL,
    APP_NAME: process.env.APP_NAME,
    APP_LOGO_URL: process.env.APP_LOGO_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    CONTACT_EMAIL: process.env.CONTACT_EMAIL,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    STORAGE_LOCAL_PATH: process.env.STORAGE_LOCAL_PATH,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    UPLOADS_BUCKET_NAME: process.env.UPLOADS_BUCKET_NAME,
    OIDC_ISSUER: process.env.OIDC_ISSUER,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_PROVIDER_NAME: process.env.OIDC_PROVIDER_NAME,
    OIDC_ADMIN_EMAILS: process.env.OIDC_ADMIN_EMAILS,
    SELF_HOST_OPEN_SIGNUP: process.env.SELF_HOST_OPEN_SIGNUP,
    ALLOWED_EMAIL_DOMAINS: process.env.ALLOWED_EMAIL_DOMAINS,
    ENABLE_AI_FEATURES: process.env.ENABLE_AI_FEATURES,
    ENABLE_EXTERNAL_MARKETS: process.env.ENABLE_EXTERNAL_MARKETS,
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_DEBUG: process.env.NEXTAUTH_DEBUG,
    APP_ENV: process.env.APP_ENV,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_VERTEX_PROJECT_ID: process.env.GOOGLE_VERTEX_PROJECT_ID,
    GOOGLE_VERTEX_LOCATION: process.env.GOOGLE_VERTEX_LOCATION,
    GOOGLE_VERTEX_CLIENT_EMAIL: process.env.GOOGLE_VERTEX_CLIENT_EMAIL,
    GOOGLE_VERTEX_PRIVATE_KEY: process.env.GOOGLE_VERTEX_PRIVATE_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    GA_MEASUREMENT_ID: process.env.GA_MEASUREMENT_ID,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    BOT_RUNNER_SECRET: process.env.BOT_RUNNER_SECRET,
    TEMPORAL_CLOCK_DISABLED: process.env.TEMPORAL_CLOCK_DISABLED,
    MAX_BOTS: process.env.MAX_BOTS,
    ORACLE_URL: process.env.ORACLE_URL,
    ORACLE_API_KEY: process.env.ORACLE_API_KEY,
    INDEXNOW_KEY: process.env.INDEXNOW_KEY,
    GOOGLE_INDEXING_CLIENT_EMAIL: process.env.GOOGLE_INDEXING_CLIENT_EMAIL,
    GOOGLE_INDEXING_PRIVATE_KEY: process.env.GOOGLE_INDEXING_PRIVATE_KEY,
    NEWS_INDEXER_SECRET: process.env.NEWS_INDEXER_SECRET,
    NEWS_INDEXER_URL: process.env.NEWS_INDEXER_URL,
    NEWS_INDEXER_API_KEY: process.env.NEWS_INDEXER_API_KEY,
    AI_PANEL_GROUNDED_TAG: process.env.AI_PANEL_GROUNDED_TAG,
    TELEGRAM_CLEAN_CHAT_ID: process.env.TELEGRAM_CLEAN_CHAT_ID,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  // validation logic
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
})
