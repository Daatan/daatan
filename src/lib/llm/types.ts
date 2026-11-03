import type { LlmStage } from './stageModels'
import { Schema } from '@google/generative-ai'

export interface LLMRequest {
  prompt: string
  schema?: Schema
  temperature?: number
  /** Lets a caller (e.g. bots/shared.ts's retry wrapper) cancel an in-flight
   *  provider call. Each provider also applies its own default timeout — this
   *  narrows that further when the caller has a tighter deadline. */
  signal?: AbortSignal
  /** Per-provider budget. When set, ResilientLLMService gives every leg of the
   *  chain its own timeout instead of letting a slow first leg spend the whole
   *  shared `signal` and start the fallbacks already aborted (#1947). */
  legTimeoutMs?: number
  /** Replaces the Vertex and Gemini legs' default timeout, for a model known to be slower
   *  (#2096). `signal` and `legTimeoutMs` can still end the call sooner. */
  googleTimeoutMs?: number
  /** Use the first leg only. A failure throws and does not page: for a call where an
   *  answer from another vendor's model is worse than an error the caller can retry. */
  primaryOnly?: boolean
  /** Per-call Google model override (e.g. 'gemini-2.5-pro' for the
   *  resolution-research verdict). Honored by the Vertex and Gemini legs only;
   *  the non-Google fallback legs keep their own pinned models, so the chain's
   *  degradation behavior is unchanged. */
  model?: string
  /** Which call site this is (#1800) — logged, and what `LLM_STAGE_MODELS` keys on. */
  stage?: LlmStage
  /** Gemini `thinkingConfig.thinkingBudget` in tokens (0 = off). Unset keeps the
   *  model's default dynamic thinking. Vertex and Gemini legs only. */
  thinkingBudget?: number
}

export interface LLMResponse {
  text: string
  /** Set when a later leg answered, so the model is not the one the stage asked for. */
  fallbackProvider?: string
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
