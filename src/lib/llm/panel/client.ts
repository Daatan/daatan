import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@/lib/logger'
import type { PanelMember } from './roster'

const log = createLogger('ai-panel-client')

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 30_000
const REGION = process.env.AWS_REGION || 'eu-central-1'

/** Lazily constructed so importing this module never needs AWS credentials — unit
 *  tests and the OpenRouter-only path must not pay for an SDK client. */
let bedrockClient: BedrockRuntimeClient | null = null
function getBedrockClient(): BedrockRuntimeClient {
  bedrockClient ??= new BedrockRuntimeClient({ region: REGION })
  return bedrockClient
}

/**
 * Hard ceiling on output tokens. The answer is one integer; anything larger means a
 * model ignored `reasoning: { enabled: false }` and started thinking out loud on our
 * bill (Gemini prices internal reasoning at the output rate). Capping bounds the
 * blast radius — the call fails and the member abstains, rather than quietly
 * costing 9× (docs/LASSO.md §5).
 */
const MAX_TOKENS = 64

/** Native structured output. All four members support `structured_outputs`, so the
 *  schema is enforced by the provider rather than steered by a system message the
 *  way OpenRouterProvider/OracleProvider have to. */
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'panel_estimate',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['probability'],
      properties: {
        probability: {
          // null = the member abstained: the claim is too vague to estimate.
          type: ['integer', 'null'],
          minimum: 0,
          maximum: 100,
        },
      },
    },
  },
} as const

/**
 * The **OpenRouter** credential is bad (401) or forbidden (403).
 *
 * Distinct from every other failure because it is a property of the shared key, not of
 * the member: if one OpenRouter member gets a 401 they all will. Retrying the other
 * OpenRouter members, or the other 56 forecasts, cannot succeed — it just burns 285
 * requests to rediscover the same fact.
 *
 * SCOPED TO THE OPENROUTER ROUTE, DELIBERATELY. Bedrock members authenticate with the
 * app's IAM role, an entirely separate credential. A Bedrock `AccessDeniedException`
 * is therefore a plain per-member failure (→ abstention), never this error: aborting
 * the sweep because one route's credential is missing would silence the members that
 * do work. Conversely, a dead OpenRouter key now disables only the OpenRouter members
 * and lets the Bedrock member keep producing estimates — which is the whole reason
 * that member exists.
 */
export class PanelAuthError extends Error {
  readonly status: number
  constructor(status: number, detail: string) {
    super(`OpenRouter rejected the API key (HTTP ${status}): ${detail}`)
    this.name = 'PanelAuthError'
    this.status = status
  }
}

export interface PanelCallResult {
  /** 0–100, or null when the member abstained. */
  probability: number | null
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
}

/**
 * Call one panel member. Returns its probability, or null for a deliberate abstention.
 *
 * Throws on transport/protocol failure. The caller records a throw as an abstention —
 * NEVER as a substituted answer. This function intentionally does not go through
 * `ResilientLLMService`, whose whole job is to fail over to the next provider: doing
 * so would write an `AiEstimate` row labelled `google/gemini-2.5-flash` containing
 * Llama's output, silently corrupting the per-model comparison.
 */
export async function callPanelMember(
  member: PanelMember,
  prompt: string,
  apiKey: string,
): Promise<PanelCallResult> {
  return member.route === 'bedrock'
    ? callBedrockMember(member, prompt)
    : callOpenRouterMember(member, prompt, apiKey)
}

/**
 * Invoke a Bedrock-hosted member with the app's IAM role.
 *
 * Uses Converse rather than raw InvokeModel so the request shape is model-agnostic —
 * adding a second Bedrock member should not mean learning another vendor's body
 * format. Converse is authorised by `bedrock:InvokeModel`, which is what
 * terraform/bedrock_invoke.tf grants.
 *
 * Without that policy applied, this throws `AccessDeniedException` — a plain Error, so
 * the member abstains and the other four are unaffected. That is the correct
 * degradation, and it means this code can ship before the Terraform lands.
 */
async function callBedrockMember(member: PanelMember, prompt: string): Promise<PanelCallResult> {
  const startedAt = Date.now()

  const response = await getBedrockClient().send(
    new ConverseCommand({
      modelId: member.model,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      // Same ceiling and determinism as the OpenRouter path. Bedrock has no
      // `reasoning: {enabled:false}` switch, but this member is the non-reasoning one,
      // so there is nothing to disable — and maxTokens still bounds a surprise.
      inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 },
    }),
  )

  const text = response.output?.message?.content?.[0]?.text
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`Empty response from ${member.model}`)
  }

  return {
    probability: parseProbability(text, member.model),
    promptTokens: response.usage?.inputTokens ?? null,
    completionTokens: response.usage?.outputTokens ?? null,
    latencyMs: Date.now() - startedAt,
  }
}

async function callOpenRouterMember(
  member: PanelMember,
  prompt: string,
  apiKey: string,
): Promise<PanelCallResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://daatan.com',
        'X-Title': 'Daatan AI Panel',
      },
      body: JSON.stringify({
        model: member.model,
        messages: [{ role: 'user', content: prompt }],
        // Determinism: with a date-gated prompt, temperature 0 means an unchanged
        // input yields an unchanged number, so the chart's step-function carry-forward
        // is exactly right rather than an approximation of resampling noise.
        temperature: 0,
        max_tokens: MAX_TOKENS,
        response_format: RESPONSE_FORMAT,
        // Hidden chain-of-thought bills at the output rate, can't explain why a
        // member's line moved (it isn't stored), and breaks determinism at temp 0.
        // A 250-token base-rate question is not a reasoning task.
        reasoning: { enabled: false },
        provider: { order: member.providerOrder ?? [], allow_fallbacks: false },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      // An auth failure is global, not per-member — surface it as its own type so the
      // sweep can stop instead of retrying it once per member per forecast.
      if (response.status === 401 || response.status === 403) {
        throw new PanelAuthError(response.status, body.slice(0, 200))
      }
      throw new Error(`OpenRouter ${response.status} for ${member.model}: ${body.slice(0, 200)}`)
    }

    const data = await response.json()
    const content: unknown = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error(`Empty response from ${member.model}`)
    }

    return {
      probability: parseProbability(content, member.model),
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Parse `{"probability": 0-100 | null}`. Strict structured output should guarantee
 * the shape, but a provider that silently ignores `response_format` would otherwise
 * poison the series with a plausible-looking number — so validate rather than trust.
 */
function parseProbability(content: string, model: string): number | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(content))
  } catch {
    throw new Error(`${model} returned non-JSON: ${content.slice(0, 120)}`)
  }

  const value = (parsed as { probability?: unknown })?.probability
  if (value === null || value === undefined) return null

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`${model} returned an out-of-range probability: ${String(value)}`)
  }
  return value
}

/**
 * Pull the JSON object out of a model reply.
 *
 * The OpenRouter path enforces a strict `response_format` schema, so its content is
 * already bare JSON and this is a no-op. Bedrock's Converse API has no equivalent, so a
 * member there may wrap the object in a ```json fence or a sentence. Extracting the
 * outermost braces is enough; the VALUE is still validated strictly afterwards, so a
 * model that emits prose and no object still fails (→ abstention) rather than being
 * coerced into a number we invented.
 */
function extractJsonObject(content: string): string {
  const text = content.trim()
  if (text.startsWith('{')) return text

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last <= first) return text // let JSON.parse throw
  return text.slice(first, last + 1)
}

/** Log a member failure at a level that won't page anyone — an abstention is expected. */
export function logMemberFailure(model: string, predictionId: string, err: unknown): void {
  log.warn({ err, model, predictionId }, 'Panel member failed — recording abstention')
}
