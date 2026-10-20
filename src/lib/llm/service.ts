import { LLMProvider, LLMRequest, LLMResponse } from './types'
import { createLogger } from '@/lib/logger'
import { notifyLlmError } from '@/lib/services/telegram'

const log = createLogger('llm-service')

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
    for (const [i, provider] of this.providers.entries()) {
      // The caller gave up (its overall deadline passed): starting another leg
      // would only fail instantly, and is not a provider outage worth paging.
      if (request.signal?.aborted) throw new Error('LLM call aborted by caller')

      const t0 = Date.now()
      const legSignal = request.legTimeoutMs
        ? AbortSignal.any([...(request.signal ? [request.signal] : []), AbortSignal.timeout(request.legTimeoutMs)])
        : request.signal
      try {
        log.info({ provider: provider.name, stage }, 'llm: start')
        const response = await provider.generateContent(legSignal === request.signal ? request : { ...request, signal: legSignal })
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

    // Every provider failed (or none were configured) — now it's a real outage.
    const providerChain = this.providers.map((p) => p.name).join(' → ') || 'none'
    notifyLlmError(providerChain, lastError?.message ?? 'no LLM providers configured')
    throw new Error(`All LLM providers failed. Last error: ${lastError?.message}`)
  }
}
