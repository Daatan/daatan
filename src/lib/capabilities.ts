import { env } from '@/env'

/**
 * Optional add-on capabilities. The SaaS edition has them always on (daatan.com
 * behavior unchanged). For the self_hosted edition they are OFF by default and
 * turn on when the operator configures the backing service — the key is the
 * opt-in, so a fresh install runs cleanly with no LLM/search/markets.
 *
 * Server-side reads (DAATAN_EDITION isn't exposed to the client); the resolved
 * booleans are passed to the client via CapabilitiesProvider.
 */

/** An LLM is configured (OpenRouter / Gemini / local Ollama). */
function hasLLM(): boolean {
  return !!(env.OPENROUTER_API_KEY || env.GEMINI_API_KEY || env.OLLAMA_BASE_URL)
}

/** A web/news search backend is configured (the Oracle). */
function hasSearch(): boolean {
  return !!(env.ORACLE_URL && env.ORACLE_API_KEY)
}

/**
 * LLM-backed creation features: Express, Guess Chances, AI extract, tag-suggest,
 * similar-forecasts. On self-host these need only an LLM key (no web search) —
 * configuring one (OpenRouter/Gemini/Ollama) turns them on. ENABLE_AI_FEATURES
 * stays as an explicit override.
 */
export function aiFeaturesEnabled(): boolean {
  if (env.DAATAN_EDITION !== 'self_hosted') return true
  return hasLLM() || env.ENABLE_AI_FEATURES === 'true'
}

/**
 * Search-backed AI: the "Analyze" context co-forecaster and resolve-time AI
 * research. These additionally need a search backend (the Oracle), so they stay
 * hidden on an LLM-only self-host rather than appearing and failing.
 */
export function aiResearchEnabled(): boolean {
  if (env.DAATAN_EDITION !== 'self_hosted') return true
  return aiFeaturesEnabled() && hasSearch()
}

/** External prediction-market integrations (Polymarket / Kalshi import + suggest-similar). */
export function externalMarketsEnabled(): boolean {
  if (env.DAATAN_EDITION !== 'self_hosted') return true
  return env.ENABLE_EXTERNAL_MARKETS === 'true'
}

export interface Capabilities {
  ai: boolean
  aiResearch: boolean
  externalMarkets: boolean
}

/** Snapshot of all capability flags — handed to the client provider from the root layout. */
export function getCapabilities(): Capabilities {
  return {
    ai: aiFeaturesEnabled(),
    aiResearch: aiResearchEnabled(),
    externalMarkets: externalMarketsEnabled(),
  }
}
