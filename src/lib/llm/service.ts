import { LLMProvider, LLMRequest, LLMResponse } from './types'
import { applyQuirks } from './quirks'
import type { ModelParams } from './registry'
import { createLogger } from '@/lib/logger'
import { notifyLlmError } from '@/lib/services/telegram'

const log = createLogger('llm-service')

/** `request` as `provider`'s model should receive it — its registry quirks applied. */
export function withModelQuirks(provider: LLMProvider, request: LLMRequest): LLMRequest {
  const model = provider.modelFor?.(request)
  if (!model) return request
  const params: ModelParams = {
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.thinkingBudget !== undefined ? { reasoningBudget: request.thinkingBudget } : {}),
  }
  const out = applyQuirks(model, params, request.forceParams)
  if (out === params) return request
  if (out.maxTokens !== undefined) {
    throw new Error(`model registry: a quirk of ${model} sets maxTokens, which the main chain does not send yet`)
  }
  const legRequest: LLMRequest = { ...request, temperature: out.temperature, thinkingBudget: out.reasoningBudget }
  if (out.temperature === undefined) delete legRequest.temperature
  if (out.reasoningBudget === undefined) delete legRequest.thinkingBudget
  return legRequest
}

export class ResilientLLMService {
  private providers: LLMProvider[]

  constructor(providers: LLMProvider[]) {
    this.providers = providers
  }

  /** Number of providers in the chain — callers size their overall deadline from it. */
  get legCount(): number {
    return this.providers.length
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    let lastError: Error | null = null

    const stage = request.stage
    const providers = request.primaryOnly ? this.providers.slice(0, 1) : this.providers
    for (const [i, provider] of providers.entries()) {
      // The caller gave up (its overall deadline passed): starting another leg
      // would only fail instantly, and is not a provider outage worth paging.
      if (request.signal?.aborted) throw new Error('LLM call aborted by caller')

      const t0 = Date.now()
      const legSignal = request.legTimeoutMs
        ? AbortSignal.any([...(request.signal ? [request.signal] : []), AbortSignal.timeout(request.legTimeoutMs)])
        : request.signal
      try {
        log.info({ provider: provider.name, stage }, 'llm: start')
        const legRequest = withModelQuirks(provider, request)
        const response = await provider.generateContent(legSignal === request.signal ? legRequest : { ...legRequest, signal: legSignal })
        log.info(
          { provider: provider.name, stage, durationMs: Date.now() - t0, tokens: response.usage?.totalTokens },
          'llm: success',
        )
        if (i > 0) {
          // #1800: a rescued call ran on a different model (usually another vendor) than
          // the stage asked for. Still not paged, but greppable per stage.
          log.warn(
            { stage, provider: provider.name, primary: this.providers[0].name, requestedModel: request.model },
            'llm: served by fallback provider',
          )
          return { ...response, fallbackProvider: provider.name }
        }
        return response
      } catch (error) {
        // A single provider failing is expected — a later one in the chain may
        // still succeed, so this is logged but NOT paged. Only a full-chain
        // failure (below) pages Telegram; a fallback that rescues the call is silent.
        log.error({ err: error, provider: provider.name, stage, durationMs: Date.now() - t0 }, 'Provider failed')
        lastError = request.legTimeoutMs && legSignal?.aborted && !request.signal?.aborted
          ? new Error(`LLM leg timeout after ${request.legTimeoutMs}ms (${provider.name})`)
          : (error as Error)
        continue // Try next provider
      }
    }

    if (request.primaryOnly && lastError) throw lastError

    // Every provider failed (or none were configured) — now it's a real outage.
    const providerChain = this.providers.map((p) => p.name).join(' → ') || 'none'
    notifyLlmError(providerChain, lastError?.message ?? 'no LLM providers configured')
    throw new Error(`All LLM providers failed. Last error: ${lastError?.message}`)
  }
}
