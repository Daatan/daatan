import { LLMProvider, LLMRequest, LLMResponse, LLMConfig } from '../types'
import { getAppUrl } from '@/lib/branding'

/** Same order of magnitude as the other fallback legs — without this, a hung
 *  connection to OpenRouter stalls the whole fallback chain indefinitely
 *  instead of failing over to the next provider. */
const OPENROUTER_TIMEOUT_MS = 30_000

export class OpenRouterProvider implements LLMProvider {
  name = 'OpenRouter'
  private apiKey: string
  private modelName: string
  private baseUrl: string

  constructor(config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error('OpenRouter API key is required')
    }
    this.apiKey = config.apiKey
    this.modelName = config.modelName
    this.baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1'
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    const messages: { role: string; content: string }[] = [
      { role: 'user', content: request.prompt },
    ]

    // When a schema is provided, append a JSON instruction to the prompt
    // (OpenRouter free models may not support native JSON schema enforcement)
    const systemContent = request.schema
      ? 'You must respond with valid JSON only. No markdown, no explanation — only the JSON object.'
      : undefined

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
      temperature: request.temperature ?? 0.7,
    }

    if (systemContent) {
      body.messages = [{ role: 'system', content: systemContent }, ...messages]
    }

    const signal = request.signal
      ? AbortSignal.any([AbortSignal.timeout(OPENROUTER_TIMEOUT_MS), request.signal])
      : AbortSignal.timeout(OPENROUTER_TIMEOUT_MS)

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': getAppUrl(),
        'X-Title': 'Daatan Bot',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenRouter API error ${response.status}: ${error}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    if (!choice) {
      throw new Error('OpenRouter returned no choices')
    }

    return {
      text: choice.message?.content ?? '',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    }
  }
}
