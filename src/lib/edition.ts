import { env } from '@/env'

/**
 * The product edition. `saas` (default) is the public daatan.com deploy;
 * `self_hosted` is a single-organization install. Shared so every edition
 * branch reads the flag the same way — see the SaaS-safety invariant in
 * docs/SELF_HOST_ARCHITECTURE.md (self-host behavior must never leak to SaaS).
 *
 * Read at call time (not module load) so tests that mock `@/env` and runtime
 * env changes both take effect.
 */
export function isSelfHosted(): boolean {
  return env.DAATAN_EDITION === 'self_hosted'
}
