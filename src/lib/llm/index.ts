import { GeminiProvider } from './providers/gemini'
import { OllamaProvider } from './providers/ollama'
import { OpenRouterProvider } from './providers/openrouter'
import { ResilientLLMService } from './service'
import type { LLMProvider } from './types'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { getOpenRouterKey, getOpenRouterModel } from '@/lib/services/settings'

const log = createLogger('llm')

// Configuration
const geminiApiKey = process.env.GEMINI_API_KEY || ''
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

// Build the main service's provider list in priority order. The OpenRouter key
// is read at build time from the admin settings (DB) → env, so re-running this
// after the settings cache warms (or after the admin saves a key) picks it up
// without a restart — see rebuildLlmService().
function buildProviders(): LLMProvider[] {
  const providers: LLMProvider[] = []

  // Only register Gemini when an API key is available. In CI/test environments
  // we often don't have a real key, so we skip Gemini and rely on fallbacks.
  if (geminiApiKey) {
    providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: 'gemini-2.5-flash' }))
  } else {
    log.warn(
      'GEMINI_API_KEY is not set; Gemini provider will be disabled. ' +
      'Only fallback providers (e.g. Ollama) will be used.',
    )
  }

  // Self-host edition: register OpenRouter when a key is configured (admin
  // setting or env), so a single admin key powers the user-facing features
  // (Express, etc.), not just bots. Scoped to self_hosted so the SaaS main
  // service stays Gemini+Ollama (SaaS uses OpenRouter only inside the bot
  // service — unchanged here).
  const openrouterApiKey = getOpenRouterKey()
  if (env.DAATAN_EDITION === 'self_hosted' && openrouterApiKey) {
    providers.push(new OpenRouterProvider({ apiKey: openrouterApiKey, modelName: getOpenRouterModel() }))
  }

  // Always register Ollama as a fallback provider (when reachable)
  providers.push(new OllamaProvider({ baseUrl: ollamaBaseUrl, modelName: 'qwen2.5:7b' }))

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

// OpenRouter no longer offers a free Gemini model (the :free Gemini slugs now
// 404). For Gemini-preference bots the OpenRouter leg is only a *fallback* —
// reached when direct Gemini is down — so it uses this free non-Google model,
// which can actually serve precisely during a Gemini/Google outage.
const OPENROUTER_FREE_FALLBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct:free'

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
