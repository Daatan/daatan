import { LLMProvider, LLMRequest, LLMResponse, LLMConfig } from '../types'
import { createLogger } from '@/lib/logger'

const log = createLogger('llm-ollama')

/** Same order of magnitude as the other fallback legs — without this, a hung
 *  connection to the local Ollama daemon stalls the whole fallback chain
 *  indefinitely instead of failing over to the next provider. */
const OLLAMA_TIMEOUT_MS = 30_000

export class OllamaProvider implements LLMProvider {
  name = 'Ollama'
  private baseUrl: string
  private modelName: string

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434'
    this.modelName = config.modelName
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    const signal = request.signal
      ? AbortSignal.any([AbortSignal.timeout(OLLAMA_TIMEOUT_MS), request.signal])
      : AbortSignal.timeout(OLLAMA_TIMEOUT_MS)

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelName,
          prompt: request.prompt,
          format: request.schema ? 'json' : undefined,
          stream: false,
          options: {
            temperature: request.temperature,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`)
      }

      const data = await response.json()
      
      return {
        text: data.response,
        usage: {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count,
            totalTokens: data.prompt_eval_count + data.eval_count
        }
      }
    } catch (error) {
      log.error({ err: error }, 'Ollama generation failed')
      throw error
    }
  }
}
