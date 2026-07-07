import { LLMProvider, LLMRequest, LLMResponse } from './types'
import { createLogger } from '@/lib/logger'
import { notifyLlmError } from '@/lib/services/telegram'

const log = createLogger('llm-service')

export class ResilientLLMService {
  private providers: LLMProvider[]

  constructor(providers: LLMProvider[]) {
    this.providers = providers
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    let lastError: Error | null = null

    for (const provider of this.providers) {
      const t0 = Date.now()
      try {
        log.info({ provider: provider.name }, 'llm: start')
        const response = await provider.generateContent(request)
        log.info(
          { provider: provider.name, durationMs: Date.now() - t0, tokens: response.usage?.totalTokens },
          'llm: success',
        )
        return response
      } catch (error) {
        // A single provider failing is expected — a later one in the chain may
        // still succeed, so this is logged but NOT paged. Only a full-chain
        // failure (below) pages Telegram; a fallback that rescues the call is silent.
        log.error({ err: error, provider: provider.name, durationMs: Date.now() - t0 }, 'Provider failed')
        lastError = error as Error
        continue // Try next provider
      }
    }

    // Every provider failed (or none were configured) — now it's a real outage.
    const providerChain = this.providers.map((p) => p.name).join(' → ') || 'none'
    notifyLlmError(providerChain, lastError?.message ?? 'no LLM providers configured')
    throw new Error(`All LLM providers failed. Last error: ${lastError?.message}`)
  }
}
