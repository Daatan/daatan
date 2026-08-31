import { LLMProvider, LLMRequest, LLMResponse } from '../types'
import { oracleFetch, type OracleConfig } from '@/lib/services/oracleClient'

/** Matches daatan's existing Oracul /llm proxy timeout; the Oracul itself caps at 55s. */
const ORACLE_TIMEOUT_MS = 60_000

/**
 * Fallback LLM provider backed by the Oracul's `/llm` endpoint (AWS Bedrock / Amazon
 * Nova via litellm). A different vendor from Google, so it survives a Gemini/Google
 * outage. The Oracul has no native JSON-schema mode, so `schema` requests are steered
 * with a system message (same tactic as {@link OpenRouterProvider}); the JSON is still
 * parsed by the caller. Returns text only — the Oracul `/llm` response carries no usage.
 */
export class OracleProvider implements LLMProvider {
  name = 'Oracul'
  private cfg: OracleConfig
  private modelName: string

  constructor(cfg: OracleConfig, modelName: string) {
    this.cfg = cfg
    this.modelName = modelName
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    const messages: { role: string; content: string }[] = []
    if (request.schema) {
      messages.push({
        role: 'system',
        content:
          'You must respond with valid JSON only. No markdown, no explanation — only the JSON object.',
      })
    }
    messages.push({ role: 'user', content: request.prompt })

    const res = await oracleFetch(this.cfg, '/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        temperature: request.temperature ?? 0.1,
      }),
      timeoutMs: ORACLE_TIMEOUT_MS,
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Oracul /llm error ${res.status}: ${body.slice(0, 200)}`)
    }

    const data = (await res.json()) as { content?: unknown }
    if (typeof data.content !== 'string' || !data.content) {
      throw new Error('Oracul /llm returned no content')
    }
    return { text: data.content }
  }
}
