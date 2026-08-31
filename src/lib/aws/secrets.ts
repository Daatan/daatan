import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm'
import { createLogger } from '@/lib/logger'
import { appEnvSlug } from './app-env'

const log = createLogger('aws-secrets')

const REGION = process.env.AWS_REGION || 'eu-central-1'
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Individually-rotatable application secrets, stored one per SSM SecureString at
 * `/daatan/<env>/secrets/<NAME>`.
 *
 * WHY NOT THE `daatan-env-<env>` BLOB
 *   That blob is a single plaintext Secrets Manager value holding every credential the
 *   app has, including the database password. Rotating one key means a read-modify-write
 *   of all of them, and anything needing one value gets `GetSecretValue` on everything.
 *   On 2026-07-10 a stale OpenRouter key inside it silently 401'd every AI-panel call,
 *   and replacing it required materialising the database password to do it.
 *
 *   One parameter per secret means: rotation is `aws ssm put-parameter --overwrite`,
 *   no redeploy (this cache expires in 5 minutes), and IAM can be scoped per path.
 *
 * WHY SSM AND NOT MORE SECRETS MANAGER
 *   Secrets Manager bills ~$0.40/secret/month. SSM SecureString (standard tier) is free,
 *   KMS-encrypted, and IAM-scopable per path. Reserve Secrets Manager for secrets that
 *   need managed rotation. See docs/SECRETS.md.
 */
export const AWS_SECRET_NAMES = ['OPENROUTER_API_KEY'] as const

/**
 * Secrets read by both environments off ONE parameter at `/daatan/shared/secrets/<NAME>`
 * — for values like the Oracul API key that retro's `oracle-api.service` and daatan's app
 * must agree on byte-for-byte. Per-env copies would just reintroduce the "shared secret
 * copied into two places, drifts silently" problem docs/SECRETS.md flags.
 */
export const SHARED_SECRET_NAMES = ['ORACLE_API_KEY'] as const

export type AwsSecretName = (typeof AWS_SECRET_NAMES)[number] | (typeof SHARED_SECRET_NAMES)[number]

const ALL_SECRET_NAMES: readonly AwsSecretName[] = [...AWS_SECRET_NAMES, ...SHARED_SECRET_NAMES]
const SHARED_NAME_SET: ReadonlySet<string> = new Set(SHARED_SECRET_NAMES)

/** Terraform creates each parameter at this sentinel; treat it as "not configured". */
const PLACEHOLDER = 'PLACEHOLDER'

const cache = new Map<AwsSecretName, string>()
let expiresAt = 0
let inFlight: Promise<void> | null = null

const ssm = new SSMClient({ region: REGION })

function pathOf(name: AwsSecretName): string {
  return SHARED_NAME_SET.has(name) ? `/daatan/shared/secrets/${name}` : `/daatan/${appEnvSlug()}/secrets/${name}`
}

/**
 * Fetch every app secret in one `GetParameters` call and cache for 5 minutes.
 *
 * Never throws: SSM being unreachable, the parameter being absent, or the instance role
 * lacking `kms:Decrypt` must all degrade to "no value", so callers fall through to their
 * env-var default rather than the app failing to boot.
 *
 * Concurrent callers share one in-flight request — a panel sweep asks for the key once
 * per forecast, and 57 simultaneous GetParameters calls would be silly.
 */
export async function warmAwsSecrets(force = false): Promise<void> {
  if (!force && Date.now() < expiresAt) return
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const res = await ssm.send(
        new GetParametersCommand({
          Names: ALL_SECRET_NAMES.map(pathOf),
          WithDecryption: true,
        }),
      )

      cache.clear()
      for (const p of res.Parameters ?? []) {
        const name = p.Name?.split('/').pop() as AwsSecretName | undefined
        if (!name || !p.Value || p.Value === PLACEHOLDER) continue
        cache.set(name, p.Value)
      }

      // InvalidParameters is the normal state before Terraform has been applied, and
      // for any secret still sitting at PLACEHOLDER. Not an error.
      if (res.InvalidParameters?.length) {
        log.debug({ missing: res.InvalidParameters }, 'SSM secrets not configured')
      }
      expiresAt = Date.now() + CACHE_TTL_MS
    } catch (err) {
      // Log once per TTL rather than once per call.
      expiresAt = Date.now() + CACHE_TTL_MS
      log.warn({ err, region: REGION }, 'Could not read SSM secrets — falling back to env')
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/**
 * Read a warmed secret. Synchronous by design: `getOpenRouterKey()` and the LLM provider
 * chain are sync, and making them async would ripple through every call site. Returns ''
 * until {@link warmAwsSecrets} has run — callers must treat that as "not configured" and
 * fall back to their env var, exactly as they did before this module existed.
 */
export function getAwsSecret(name: AwsSecretName): string {
  return cache.get(name) ?? ''
}

/** Test seam. */
export function __resetAwsSecretsCache(): void {
  cache.clear()
  expiresAt = 0
  inFlight = null
}
