/**
 * The environment slug used in AWS resource paths: `/daatan/<slug>/...`
 *
 * Shared by the Bedrock prompt loader and the SSM secret loader so a parameter written
 * for one is readable by the other. Previously this mapping lived inline in
 * bedrock-prompts.ts; two copies would eventually disagree about what "next" means and
 * the second reader would silently fall back to defaults.
 */
export function appEnvSlug(): string {
  const raw = process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || 'staging'
  if (raw === 'production') return 'prod'
  // The NEXT preview environment shares staging's parameters — it has no AWS
  // resources of its own.
  if (raw === 'next') return 'staging'
  return raw
}
