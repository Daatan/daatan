import { env } from '@/env'

/**
 * Optional add-on capabilities. The SaaS edition has them always on (daatan.com
 * behavior unchanged). The self_hosted edition has them OFF by default — an
 * operator opts in explicitly — so a fresh install runs cleanly with no Oracle,
 * web/news search, LLM, or external-market integrations.
 *
 * These are server-side reads (DAATAN_EDITION is not exposed to the client);
 * the resolved booleans are passed to the client via CapabilitiesProvider.
 */

/** AI co-forecaster / web search / LLM features (Analyze, Express, Guess Chances, AI extract & tag-suggest). */
export function aiFeaturesEnabled(): boolean {
  if (env.DAATAN_EDITION !== 'self_hosted') return true
  return env.ENABLE_AI_FEATURES === 'true'
}

/** External prediction-market integrations (Polymarket / Kalshi import + suggest-similar). */
export function externalMarketsEnabled(): boolean {
  if (env.DAATAN_EDITION !== 'self_hosted') return true
  return env.ENABLE_EXTERNAL_MARKETS === 'true'
}

export interface Capabilities {
  ai: boolean
  externalMarkets: boolean
}

/** Snapshot of all capability flags — handed to the client provider from the root layout. */
export function getCapabilities(): Capabilities {
  return { ai: aiFeaturesEnabled(), externalMarkets: externalMarketsEnabled() }
}
