/**
 * The AI panel's members (docs/AI_PANEL.md §5).
 *
 * Deliberately data, not code: `AiEstimate.model` and `.mode` are stored as plain
 * strings, so adding or dropping a member is one entry here and no migration.
 * Per-member Brier is what decides who stays — don't agonize over the roster.
 */

/** Ungrounded = claim + dates + rules, no article text, no web search. */
export type PanelMode = 'ungrounded'

/**
 * Where a member's inference runs.
 *
 * `bedrock` members use the app's own IAM role (billed to AWS, covered by credits) and
 * survive an OpenRouter outage or a dead OpenRouter key — which is not hypothetical:
 * on 2026-07-10 a stale key made every one of the panel's 285 calls return 401.
 */
export type PanelRoute = 'openrouter' | 'bedrock'

export interface PanelMember {
  /**
   * The provider's model identifier — an OpenRouter slug, or a Bedrock model id.
   * Stored verbatim as `AiEstimate.model`.
   *
   * A member that moves between routes therefore gets a NEW identifier, and is
   * correctly treated as a different member for per-member Brier. That is deliberate:
   * `qwen.qwen3-235b-a22b-2507-v1:0` on Bedrock and `qwen/qwen3-235b-a22b-2507` on
   * DeepInfra are the same weights, but not necessarily the same quantization, and
   * pretending otherwise would silently merge two series.
   */
  model: string
  mode: PanelMode
  route: PanelRoute
  /**
   * OpenRouter provider tags to pin, most-preferred first, with fallbacks off.
   * Ignored for `route: 'bedrock'` (AWS serves one implementation).
   *
   * Unpinned, OpenRouter routes a single slug to whichever backend is cheapest or
   * fastest right now — and those backends serve different quantizations (qwen3-235b
   * is fp8 on every provider, but which fp8 varies). Run-to-run variance would then
   * get misattributed to the model and quietly corrupt the per-member Brier
   * comparison that this whole feature exists to produce.
   *
   * Tags verified against https://openrouter.ai/api/v1/models/{slug}/endpoints.
   */
  providerOrder?: string[]
  /**
   * A deliberately weak member. If the control ties the strong members on Brier,
   * the instrument is not measuring anything and a flat leaderboard is
   * uninterpretable. Costs ~$0.20/mo to know.
   */
  control?: boolean
}

/** True when any member needs an OpenRouter key. A Bedrock-only roster is not dormant
 *  just because no OpenRouter key is configured. */
export function needsOpenRouter(members: readonly PanelMember[] = PANEL_MEMBERS): boolean {
  return members.some((m) => m.route === 'openrouter')
}

export const PANEL_MEMBERS: readonly PanelMember[] = [
  // Non-reasoning, and the most decorrelated lineage available (non-Western corpus
  // and RLHF). Doubles as the deterministic baseline: no hidden thinking tokens.
  //
  // Routed via Bedrock, not OpenRouter: identical weights, billed to AWS credits, and
  // — the actual reason — it keeps the panel producing estimates when OpenRouter is
  // down or its key is stale. Note the model ID differs from the OpenRouter slug, so
  // Brier treats this as a distinct member from any historical `qwen/...` rows.
  // Requires terraform/bedrock_invoke.tf to be applied; without it the member fails
  // AccessDenied and abstains, which is the correct degradation.
  {
    model: 'qwen.qwen3-235b-a22b-2507-v1:0',
    mode: 'ungrounded',
    route: 'bedrock',
  },

  { model: 'openai/gpt-5-mini', mode: 'ungrounded', route: 'openrouter', providerOrder: ['openai'] },

  // google-vertex/eu keeps claim text in the EU, matching where the rest of the
  // stack runs (eu-central-1).
  {
    model: 'google/gemini-2.5-flash',
    mode: 'ungrounded',
    route: 'openrouter',
    providerOrder: ['google-vertex/eu'],
  },

  { model: 'x-ai/grok-4.3', mode: 'ungrounded', route: 'openrouter', providerOrder: ['xai'] },

  {
    model: 'openai/gpt-5-nano',
    mode: 'ungrounded',
    route: 'openrouter',
    providerOrder: ['openai'],
    control: true,
  },
] as const

/**
 * Stable fingerprint of the roster, folded into the run's input hash. Adding or
 * removing a member therefore forces a fresh sweep rather than silently producing
 * runs with different member sets under the same hash.
 */
export function rosterSignature(members: readonly PanelMember[] = PANEL_MEMBERS): string {
  return members
    .map((m) => `${m.model}:${m.mode}`)
    .sort()
    .join(',')
}
