import { Schema } from '@google/generative-ai'

export interface LLMRequest {
  prompt: string
  schema?: Schema
  temperature?: number
  /** Lets a caller (e.g. bots/shared.ts's retry wrapper) cancel an in-flight
   *  provider call. Each provider also applies its own default timeout — this
   *  narrows that further when the caller has a tighter deadline. */
  signal?: AbortSignal
  /** Per-call Google model override (e.g. 'gemini-2.5-pro' for the
   *  resolution-research verdict). Honored by the Vertex and Gemini legs only;
   *  the non-Google fallback legs keep their own pinned models, so the chain's
   *  degradation behavior is unchanged. */
  model?: string
}

export interface LLMResponse {
  text: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface LLMProvider {
  name: string
  generateContent(request: LLMRequest): Promise<LLMResponse>
}

export interface LLMConfig {
  apiKey?: string
  baseUrl?: string
  modelName: string
}
