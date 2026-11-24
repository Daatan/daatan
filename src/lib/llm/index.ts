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
import { CHAIN, chainModel, EVIDENCE_SECOND_OPINION } from './registry'
import { LLM_STAGES, stageModel, stageModelSource } from './stageModels'

const log = createLogger('llm')

// Configuration
const geminiApiKey = process.env.GEMINI_API_KEY || ''

// The main service's legs, in the registry's chain order (registry.ts `CHAIN`). Each leg
// registers only when it's configured, so a call is never single-vendor in practice. The
// OpenRouter/Oracul keys are read at build time from admin settings (DB) → env, so
// re-running this after the settings cache warms (or after the admin saves a key) picks
// it up without a restart — see rebuildLlmService().
function buildProviders(): LLMProvider[] {
  const providers: LLMProvider[] = []
  for (const leg of CHAIN) {
    if (leg.provider === 'google') {
      // Gemini via Vertex (#1472), when its service account is provisioned, AHEAD of the
      // Developer-API leg rather than replacing it: if Vertex is misconfigured or out of
      // quota, the key-based leg is right behind it. Daatan's own SaaS containers carry no
      // GEMINI_API_KEY (#1472), so in production that leg does not register and the chain
      // falls through to the next vendor. It stays for the self-host edition, where a
      // Developer API key is the easy path.
      const vertex = vertexEnv()
      if (vertex) providers.push(new VertexProvider({ ...vertex, modelName: leg.model }))
      if (geminiApiKey) {
        providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: leg.model }))
      } else if (!vertex) {
        log.warn(
          'Neither GOOGLE_VERTEX_* nor GEMINI_API_KEY is set; both Google legs will be ' +
          'disabled. Only fallback providers will be used.',
        )
      }
    } else if (leg.provider === 'oracle') {
      // The Oracul's /llm — a no-op on self-host installs that don't reach Daatan's Oracul.
      const oracleConfig = getOracleConfig()
      if (oracleConfig) providers.push(new OracleProvider(oracleConfig, leg.model))
    } else if (leg.provider === 'openrouter') {
      // Both editions, whenever a key is configured (admin setting → env). Self-host runs
      // it as a user-facing provider on the admin-chosen model (a documented runtime
      // choice); SaaS only as the last-resort backstop on the registry's model.
      const openrouterApiKey = getOpenRouterKey()
      if (openrouterApiKey) {
        const openrouterModel = isSelfHosted() ? getOpenRouterModel() : leg.model
        providers.push(new OpenRouterProvider({ apiKey: openrouterApiKey, modelName: openrouterModel }))
      }
    } else {
      // Skipping the localhost:11434 default avoids a dead provider slot (and its false
      // "provider failed" pages) on hosts that don't run Ollama, e.g. prod.
      const ollamaBaseUrl = process.env.OLLAMA_BASE_URL
      if (ollamaBaseUrl) providers.push(new OllamaProvider({ baseUrl: ollamaBaseUrl, modelName: leg.model }))
    }
  }
  logModelConfigOnce()
  return providers
}

let modelConfigLogged = false

/** One `model_config` line per role at startup, so the server shows which values are live
 *  and where each came from (daatan#2287) — the check before env overrides are removed. */
function logModelConfigOnce(): void {
  if (modelConfigLogged) return
  modelConfigLogged = true
  for (const leg of CHAIN) {
    log.info({ event: 'model_config', role: `chain.${leg.provider}`, model: leg.model, source: 'registry' }, 'model_config')
  }
  for (const stage of LLM_STAGES) {
    log.info({ event: 'model_config', role: `stage.${stage}`, model: stageModel(stage), source: stageModelSource(stage) }, 'model_config')
  }
  const secondOpinionEnv = process.env.EVIDENCE_SECOND_OPINION_MODEL
  log.info(
    {
      event: 'model_config',
      role: 'evidence_second_opinion',
      model: secondOpinionEnv || EVIDENCE_SECOND_OPINION.model,
      source: secondOpinionEnv ? 'env' : 'registry',
    },
    'model_config',
  )
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
 * Used by the bot runner where each bot may have a different model preference — a
 * documented runtime choice (DB, admin-editable), not a registry entry. Its fallbacks
 * are the registry's chain models.
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

  const isGemini = resolvedModelName.toLowerCase().includes('gemini')
  const vertex = vertexEnv()

  // If model looks like a Google model and we have Vertex or a direct key, try Google first
  if (isGemini && (vertex || geminiApiKey)) {
    // Extract base model name from OpenRouter slug
    // e.g. "google/gemini-2.0-flash:free" -> "gemini-2.0-flash"
    let directModelName = resolvedModelName.split(':').shift()?.split('/').pop() || 'gemini-1.5-flash'

    // Remap legacy direct-API model names to the current stable ID
    if (directModelName === 'gemini-2.0-flash-exp' || directModelName === 'gemini-2.5-flash-preview' || directModelName === 'gemini-1.5-flash' || directModelName === 'gemini-1.5-pro') {
      directModelName = chainModel('google')
    }

    // Vertex first (#1879): prod containers carry no GEMINI_API_KEY (#1472), so
    // without this leg a Gemini-preference bot gets zero providers.
    if (vertex) {
      log.info({ modelName: resolvedModelName, directModelName }, 'Trying Vertex provider for bot')
      providers.push(new VertexProvider({ ...vertex, modelName: directModelName }))
    }
    if (geminiApiKey) {
      log.info({ modelName: resolvedModelName, directModelName }, 'Trying direct Gemini provider for bot')
      providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: directModelName }))
    }
  }

  if (openrouterApiKey) {
    // A Gemini preference gets the chain's non-Google OpenRouter model here, so this
    // fallback leg works when Gemini/Google is the thing that's unavailable.
    const openrouterModel = isGemini
      ? chainModel('openrouter')
      : resolvedModelName
    log.info({ modelName: openrouterModel }, 'Adding OpenRouter provider for bot')
    providers.push(new OpenRouterProvider({ apiKey: openrouterApiKey, modelName: openrouterModel }))
  }

  // Final fallback: the chain's stable Gemini model if we have a key and the requested model was Gemini
  if (resolvedModelName.toLowerCase().includes('gemini') && geminiApiKey) {
    log.info({ modelName: chainModel('google') }, 'Adding the chain Gemini model as final fallback')
    providers.push(new GeminiProvider({ apiKey: geminiApiKey, modelName: chainModel('google') }))
  }

  if (providers.length === 0) {
    log.warn({ modelName: resolvedModelName, hasOpenRouter: !!openrouterApiKey, hasGemini: !!geminiApiKey, hasVertex: !!vertex }, 'No LLM providers available for bot')
  }

  return new ResilientLLMService(providers)
}
