import { GeminiProvider } from './providers/gemini'
import { VertexProvider, vertexEnv } from './providers/vertex'
import { OllamaProvider } from './providers/ollama'
import { OpenRouterProvider } from './providers/openrouter'
import { OracleProvider } from './providers/oracle'
import { ResilientLLMService } from './service'
import type { LLMProvider } from './types'
import { createLogger } from '@/lib/logger'
import { isSelfHosted } from '@/lib/edition'
import { getOpenRouterKey, getOpenRouterModel } from '@/lib/services/settings'
import { getOracleConfig } from '@/lib/services/oracleClient'

const log = createLogger('llm')

// Configuration
const geminiApiKey = process.env.GEMINI_API_KEY || ''

/** One model name for both Google legs — they must not silently diverge. */
const GEMINI_MODEL = 'gemini-2.5-flash'

// The Oracul fallback leg runs on AWS Bedrock / Amazon Nova (a different vendor
// from Google), so it can serve precisely when Gemini/Google is unavailable. We
// pin an explicit model rather than inherit the Oracul's pipeline default.
const ORACLE_FALLBACK_MODEL = 'bedrock/amazon.nova-pro-v1:0'

// OpenRouter no longer offers a free Gemini model (the :free Gemini slugs now
// 404). Both the SaaS main-chain fallback and the Gemini-preference bot leg use
// this free NON-Google model — it's only reached when direct Gemini is down, so
// it must not route back to Google, and it can actually serve during a Google outage.
const OPENROUTER_FREE_FALLBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct:free'

// Build the main service's provider list in priority order:
//   Gemini → Oracul (Bedrock/Nova) → OpenRouter → Ollama
// Each leg registers only when it's configured, so a call is never Gemini-only in
// practice. The OpenRouter/Oracul keys are read at build time from admin settings
// (DB) → env, so re-running this after the settings cache warms (or after the admin
// saves a key) picks it up without a restart — see rebuildLlmService().
function buildProviders(): LLMProvider[] {
  const providers: LLMProvider[] = []

  // Primary: Gemini via Vertex (#1472), when its service account is provisioned.
  // Same model, same schemas — only the billing surface differs, and Vertex has no
  // prepaid balance that can hit zero. Registered AHEAD of the Developer-API leg
  // rather than replacing it: if Vertex is misconfigured or its quota is exhausted,
  // the key-based leg below is right behind it and the chain still serves. Daatan's
  // own SaaS containers no longer carry GEMINI_API_KEY (#1472), so in production
  // that leg does not register at all and the chain falls through to Oracul/Bedrock
  // — a different vendor, which is the more useful fallback anyway. The leg stays in
  // the code for the self-host edition, where a Developer API key is the easy path.
  const vertex = vertexEnv()
  if (vertex) {
    providers.push(new VertexProvider({ ...vertex, modelName: GEMINI_MODEL }))
  }

  // Direct Gemini (Developer API, key-based). In CI/test we often have no key, so
  // skip it and rely on the fallbacks below.
  if (geminiApiKey) {
    providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: GEMINI_MODEL }))
  } else if (!vertex) {
    log.warn(
      'Neither GOOGLE_VERTEX_* nor GEMINI_API_KEY is set; both Google legs will be ' +
      'disabled. Only fallback providers will be used.',
    )
  }

  // Fallback 1: the Oracul's /llm (AWS Bedrock / Amazon Nova) — a different vendor
  // from Google, so it survives a Gemini/Google outage. Registered whenever the
  // Oracul is configured (ORACLE_URL + ORACLE_API_KEY); a no-op otherwise, e.g. on
  // self-host installs that don't reach Daatan's Oracul.
  const oracleConfig = getOracleConfig()
  if (oracleConfig) {
    providers.push(new OracleProvider(oracleConfig, ORACLE_FALLBACK_MODEL))
  }

  // Fallback 2: OpenRouter. Registered whenever a key is configured (admin setting
  // → env), for BOTH editions. Self-host runs it as a primary user-facing provider
  // on the admin-chosen model; SaaS adds it only as a last-resort backstop, so it
  // defaults to the free NON-Google model (an OpenRouter *Gemini* model would still
  // hit Google's backend and die in the same outage).
  const openrouterApiKey = getOpenRouterKey()
  if (openrouterApiKey) {
    const openrouterModel = isSelfHosted() ? getOpenRouterModel() : OPENROUTER_FREE_FALLBACK_MODEL
    providers.push(new OpenRouterProvider({ apiKey: openrouterApiKey, modelName: openrouterModel }))
  }

  // Fallback 3: local Ollama — only when explicitly configured. Skipping the
  // localhost:11434 default avoids a dead provider slot (and its false "provider
  // failed" pages) on hosts that don't run Ollama, e.g. prod.
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL
  if (ollamaBaseUrl) {
    providers.push(new OllamaProvider({ baseUrl: ollamaBaseUrl, modelName: 'qwen2.5:7b' }))
  }

  return providers
}

// Main service with fallback strategy; tries providers in registration order.
// `let` (not `const`) + a live ES binding so rebuildLlmService() can swap in a
// service that reflects a newly-configured OpenRouter key without a restart.
export let llmService = new ResilientLLMService(buildProviders())

/**
 * Rebuild the main LLM service from current settings. Called after the settings
 * cache warms at boot and whenever the admin saves the OpenRouter key, so
 * self-host AI turns on/off live. No-op effect on SaaS (providers are unchanged
 * there). Importers using `import { llmService }` see the new instance via the
 * live binding.
 */
export function rebuildLlmService(): void {
  llmService = new ResilientLLMService(buildProviders())
}

// OpenRouter model IDs that have been renamed; map old → current.
const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'google/gemini-2.5-flash-preview:free': 'google/gemini-2.5-flash:free',
  'google/gemini-2.5-flash-preview':      'google/gemini-2.5-flash',
  'google/gemini-2.0-flash-exp:free':     'google/gemini-2.0-flash:free',
  'google/gemini-2.0-flash-exp':          'google/gemini-2.0-flash',
}

/**
 * Creates an LLM service backed by OpenRouter for a specific model.
 * Used by the bot runner where each bot may have a different model preference.
 */
export function createBotLLMService(modelName: string): ResilientLLMService {
  const openrouterApiKey = process.env.OPENROUTER_API_KEY || ''
  const geminiApiKey = process.env.GEMINI_API_KEY || ''

  const providers: LLMProvider[] = []

  // Normalise stale OpenRouter slugs before using them anywhere
  const resolvedModelName = OPENROUTER_MODEL_ALIASES[modelName] ?? modelName
  if (resolvedModelName !== modelName) {
    log.info({ from: modelName, to: resolvedModelName }, 'Resolved deprecated OpenRouter model alias')
  }

  // If model looks like a Google model and we have a direct key, try direct provider first
  if (resolvedModelName.toLowerCase().includes('gemini') && geminiApiKey) {
    // Extract base model name from OpenRouter slug
    // e.g. "google/gemini-2.0-flash:free" -> "gemini-2.0-flash"
    let directModelName = resolvedModelName.split(':').shift()?.split('/').pop() || 'gemini-1.5-flash'

    // Remap legacy direct-API model names to the current stable ID
    if (directModelName === 'gemini-2.0-flash-exp' || directModelName === 'gemini-2.5-flash-preview' || directModelName === 'gemini-1.5-flash' || directModelName === 'gemini-1.5-pro') {
      directModelName = 'gemini-2.5-flash'
    }

    log.info({ modelName: resolvedModelName, directModelName }, 'Trying direct Gemini provider for bot')
    providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: directModelName }))
  }

  if (openrouterApiKey) {
    // No free Gemini exists on OpenRouter; substitute a free non-Google model so
    // this fallback leg works when Gemini/Google is the thing that's unavailable.
    const openrouterModel = resolvedModelName.toLowerCase().includes('gemini')
      ? OPENROUTER_FREE_FALLBACK_MODEL
      : resolvedModelName
    log.info({ modelName: openrouterModel }, 'Adding OpenRouter provider for bot')
    providers.push(new OpenRouterProvider({ apiKey: openrouterApiKey, modelName: openrouterModel }))
  }

  // Final fallback: direct stable Gemini if we have a key and requested model was Gemini
  if (resolvedModelName.toLowerCase().includes('gemini') && geminiApiKey) {
    log.info('Adding stable gemini-2.5-flash as final fallback')
    providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: 'gemini-2.5-flash' }))
  }

  if (providers.length === 0) {
    log.warn({ modelName: resolvedModelName, hasOpenRouter: !!openrouterApiKey, hasGemini: !!geminiApiKey }, 'No LLM providers available for bot')
  }

  return new ResilientLLMService(providers)
}
