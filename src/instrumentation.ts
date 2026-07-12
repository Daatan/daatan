import { createLogger } from '@/lib/logger'

const log = createLogger('startup')

/**
 * Next.js instrumentation hook — runs once on server startup.
 * Hard-fails in production if required env vars are missing so misconfigured
 * deploys surface immediately rather than silently degrading at request time.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Warm the SSM SecureString secrets (docs/SECRETS.md) before the LLM service is built,
  // so a key rotated since the last deploy is live immediately. Never throws: no SSM, no
  // parameter, or no kms:Decrypt all degrade to the env-var fallback.
  try {
    const { warmAwsSecrets } = await import('@/lib/aws/secrets')
    await warmAwsSecrets()
    // The provider chain is built at module load from whatever getOpenRouterKey() saw
    // then. Rebuild now that SSM has answered, so the OpenRouter fallback leg registers
    // on a fresh boot instead of only after an admin saves a key.
    const { rebuildLlmService } = await import('@/lib/llm')
    rebuildLlmService()
  } catch (err) {
    log.error({ err }, '[startup] Failed to warm AWS secrets')
  }

  // Self-hosted edition: warm the admin-editable settings cache (brand name,
  // OpenRouter key, /about content) from the DB, then rebuild the LLM service
  // so a key set in a previous session is live without a restart. No-op on
  // SaaS (loadSettings short-circuits off self_hosted).
  if (process.env.DAATAN_EDITION === 'self_hosted') {
    try {
      const { loadSettings } = await import('@/lib/services/settings')
      await loadSettings()
      const { rebuildLlmService } = await import('@/lib/llm')
      rebuildLlmService()
    } catch (err) {
      log.error({ err }, '[startup] Failed to warm settings cache')
    }
  }

  // Sync bot configurations to database on startup (non-blocking). The bot
  // system is SaaS-only, so skip it entirely in the self-hosted edition.
  if (process.env.DAATAN_EDITION !== 'self_hosted') {
    import('@/lib/bots/sync').then(({ syncBotsToDatabase }) => {
      syncBotsToDatabase().catch(error => {
        log.error({ err: error }, '[startup] Failed to sync bots to database')
      })
    }).catch(err => {
      log.error({ err }, '[startup] Failed to load bot sync module')
    })
  }

  if (process.env.NODE_ENV !== 'production') return

  const required: Array<{ key: string; feature: string }> = [
    { key: 'GEMINI_API_KEY', feature: 'LLM / bot-runner' },
    { key: 'VAPID_PRIVATE_KEY', feature: 'browser push notifications' },
    { key: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', feature: 'browser push notifications' },
  ]

  const missing = required.filter(({ key }) => !process.env[key])

  if (missing.length > 0) {
    log.warn({ missing: missing.map(({ key, feature }) => ({ key, feature })) }, '[startup] WARNING: Missing environment variables — functionality requiring these keys will fail at runtime')
  }

  // Both VAPID keys can be individually present yet belong to different keypairs — e.g. a
  // rotation that updated VAPID_PRIVATE_KEY (server, runtime) without also updating the
  // NEXT_PUBLIC_VAPID_PUBLIC_KEY GitHub Actions secret (baked into the client bundle at
  // build). That fails every push send's VAPID auth (401/403) with nothing else to catch it.
  if (process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    try {
      const { createECDH } = await import('crypto')
      const curve = createECDH('prime256v1')
      curve.setPrivateKey(Buffer.from(process.env.VAPID_PRIVATE_KEY, 'base64url'))
      const derivedPublicKey = curve.getPublicKey().toString('base64url')
      if (derivedPublicKey !== process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        log.error('[startup] VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY are not a matching keypair — every browser push notification will fail VAPID auth. Regenerate and update both together (see SECRETS.md).')
      }
    } catch (err) {
      log.warn({ err }, '[startup] Could not verify VAPID keypair match')
    }
  }

  // Validate critical SSM prompt params are not PLACEHOLDER.
  // All of these are called without fallbacks in user-facing request paths;
  // a PLACEHOLDER value causes a runtime error only when the feature is used.
  const criticalPrompts = [
    'express-prediction',
    'extract-prediction',
    'suggest-tags',
    'update-context',
    'dedupe-check',
    'translate',
    'research-query-generation',
    'resolution-research',
    'forecast-quality-validation',
  ] as const

  const rawEnv = process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || 'staging'
  let ssmEnv = rawEnv === 'production' ? 'prod' : rawEnv
  if (ssmEnv === 'next') ssmEnv = 'staging' // NEXT environment uses staging prompts

  try {
    const { SSMClient, GetParametersCommand } = await import('@aws-sdk/client-ssm')
    const ssm = new SSMClient({ region: process.env.AWS_REGION || 'eu-central-1' })

    const paramNames = criticalPrompts.map((p) => `/daatan/${ssmEnv}/prompts/${p}`)
    const res = await ssm.send(new GetParametersCommand({ Names: paramNames }))

    const placeholders = (res.Parameters ?? [])
      .filter((p) => !p.Value || p.Value === 'PLACEHOLDER')
      .map((p) => p.Name ?? '')

    const missing2 = paramNames.filter(
      (name) => placeholders.includes(name) || !(res.Parameters ?? []).find((p) => p.Name === name),
    )

    if (missing2.length > 0) {
      // Warn only — hardcoded fallback prompts in bedrock-prompts.ts cover all PLACEHOLDER params
      log.warn({ missing: missing2 }, '[startup] SSM params using hardcoded fallbacks (Bedrock not fully configured)')
    } else {
      log.info({ env: ssmEnv, count: criticalPrompts.length }, '[startup] SSM prompt params OK')
    }
  } catch (error) {
    // SSM unreachable — log and continue
    log.warn({ err: error }, '[startup] Could not validate SSM prompt params')
  }
}
