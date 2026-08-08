import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { LLMProvider, LLMRequest, LLMResponse, LLMConfig } from '../types'

/** Same order of magnitude as the other fallback legs (oracle.ts 60s, panel/client.ts
 *  30s) — without this, a hung Gemini connection stalls the whole fallback chain
 *  indefinitely instead of failing over to the next provider. */
const GEMINI_TIMEOUT_MS = 30_000

export class GeminiProvider implements LLMProvider {
  name = 'Gemini'
  private genAI: GoogleGenerativeAI
  private modelName: string

  constructor(config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini API key is required')
    }
    this.genAI = new GoogleGenerativeAI(config.apiKey)
    this.modelName = config.modelName
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: request.schema ? 'application/json' : 'text/plain',
        responseSchema: request.schema,
        temperature: request.temperature,
      },
    })

    const result = await model.generateContent(request.prompt, {
      timeout: GEMINI_TIMEOUT_MS,
      signal: request.signal,
    })
    const response = result.response
    
    return {
      text: response.text(),
      usage: result.response.usageMetadata ? {
        promptTokens: result.response.usageMetadata.promptTokenCount,
        completionTokens: result.response.usageMetadata.candidatesTokenCount,
        totalTokens: result.response.usageMetadata.totalTokenCount
      } : undefined
    }
  }
}
