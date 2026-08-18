import type { LLMProvider, LLMRequest, LLMResponse } from '../types'
import { googleAccessToken } from '@/lib/services/google-auth'

/**
 * Gemini via Vertex AI (daatan#1472).
 *
 * Same models, same request shape, different billing surface: Google is forcing
 * the Gemini *Developer* API from Postpay to Prepay by 2026-09-14, while Vertex
 * (`aiplatform.googleapis.com`) stays on Postpay as an ordinary GCP service and
 * draws the credits billing account directly — no prepaid balance to keep funded,
 * and so no balance-hits-zero outage mode.
 *
 * Deliberately REST rather than an SDK. The migration was originally scoped as
 * "swap @google/generative-ai for the Vertex SDK across ~8 call sites", but none of
 * that churn is actually necessary: Vertex accepts the very same
 * `responseMimeType`/`responseSchema` generation config the existing `Schema`
 * objects already describe, so every schema in `llm/schemas/`, `llm/gemini.ts`,
 * moderation, the bots and the temporal classifier carries over untouched. The only
 * real differences are the endpoint and Bearer auth instead of `?key=`.
 */

const VERTEX_TIMEOUT_MS = 30_000

/** Vertex is authorised by ordinary GCP scope, not a per-API scope. */
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

export interface VertexConfig {
  projectId: string
  /** `global` avoids pinning a region and is what Gemini models serve from by default. */
  location: string
  clientEmail: string
  privateKey: string
  modelName: string
}

interface VertexResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

function endpointFor(config: VertexConfig): string {
  // The regional host is required for regional locations; `global` is served from
  // the unprefixed host, and prefixing it 404s.
  const host =
    config.location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${config.location}-aiplatform.googleapis.com`
  return (
    `https://${host}/v1/projects/${config.projectId}` +
    `/locations/${config.location}/publishers/google/models/${config.modelName}:generateContent`
  )
}

export class VertexProvider implements LLMProvider {
  name = 'Vertex'
  private config: VertexConfig

  constructor(config: VertexConfig) {
    if (!config.projectId || !config.clientEmail || !config.privateKey) {
      throw new Error('Vertex requires projectId, clientEmail and privateKey')
    }
    this.config = config
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    // Wired up BEFORE the token exchange, and covering it. The exchange is itself
    // two network round-trips, so a caller that gives up during it would otherwise
    // be ignored and the request issued anyway — and a listener attached to an
    // already-aborted signal never fires, so registering afterwards silently loses
    // the abort. Same 30s budget as the Gemini leg: without it a hung connection
    // stalls the whole fallback chain instead of failing over.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VERTEX_TIMEOUT_MS)
    const onCallerAbort = () => controller.abort()
    if (request.signal?.aborted) controller.abort()
    else request.signal?.addEventListener('abort', onCallerAbort)

    try {
      const token = await googleAccessToken(
        this.config.clientEmail,
        this.config.privateKey,
        CLOUD_PLATFORM_SCOPE,
      )
      // fetch rejects on an already-aborted signal, so an abort landing during the
      // exchange fails here rather than reaching Vertex.
      const res = await fetch(endpointFor(this.config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseMimeType: request.schema ? 'application/json' : 'text/plain',
            ...(request.schema ? { responseSchema: request.schema } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          },
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        // Body first: Vertex puts the actionable part (quota, disabled API, bad
        // model id, SA missing aiplatform.user) in the payload, not the status.
        const body = await res.text()
        throw new Error(`Vertex ${res.status}: ${body.slice(0, 300)}`)
      }

      const data = (await res.json()) as VertexResponse
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      // Throw rather than return '': the service treats a provider error as
      // "fall through to the next leg", and an empty string would instead be
      // handed to a JSON.parse downstream as if it were a real answer.
      if (text === undefined) throw new Error('Vertex returned no candidate text')

      return {
        text,
        usage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount ?? 0,
              completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
              totalTokens: data.usageMetadata.totalTokenCount ?? 0,
            }
          : undefined,
      }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onCallerAbort)
    }
  }
}
