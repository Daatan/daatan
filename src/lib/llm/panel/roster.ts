/**
 * The AI panel's members (docs/LASSO.md §5).
 *
 * Deliberately data, not code: `AiEstimate.model` and `.mode` are stored as plain
 * strings, so adding or dropping a member is one entry here and no migration.
 * Per-member Brier is what decides who stays — don't agonize over the roster.
 */

/**
 * Ungrounded = claim + dates + rules, no article text, no web search.
 * Grounded-indexer = the same, plus the top news-indexer snippets matched to the claim
 * (docs/LASSO.md §9a): our own index rather than vendor web search, so it costs tokens
 * only — no per-request search fees.
 */
export type PanelMode = 'ungrounded' | 'grounded-indexer'

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

  // Was openai/gpt-5-mini. OpenAI's entire gpt-5 lineup on OpenRouter is reasoning-
  // MANDATORY: `reasoning: {enabled: false}` returns HTTP 400 "Reasoning is mandatory
  // for this endpoint and cannot be disabled", so every call 401-style failed and the
  // member abstained 100% of the time (confirmed on staging 2026-07-11, all 56 rows
  // null). Reasoning models are incompatible with this panel by design — temperature 0,
  // no hidden thinking, one cheap integer, a deterministic step-function chart. DeepSeek
  // is a strong independent lineage (distinct from Alibaba/Google/xAI) and answers in
  // ~7 tokens with reasoning off. Verified against the live API before landing.
  {
    model: 'deepseek/deepseek-chat',
    mode: 'ungrounded',
    route: 'openrouter',
    providerOrder: ['deepinfra/fp4'],
  },

  // google-vertex/eu keeps claim text in the EU, matching where the rest of the
  // stack runs (eu-central-1).
  {
    model: 'google/gemini-2.5-flash',
    mode: 'ungrounded',
    route: 'openrouter',
    providerOrder: ['google-vertex/eu'],
  },

  { model: 'x-ai/grok-4.3', mode: 'ungrounded', route: 'openrouter', providerOrder: ['xai'] },

  // Was openai/gpt-5-nano (same reasoning-mandatory 400 as gpt-5-mini). The control is
  // deliberately WEAK — if it ties the strong members on Brier, the instrument is not
  // measuring anything. A 4B open-weights model is a cleaner control than a mini
  // frontier model ever was. Verified: ~8 tokens, reasoning off.
  {
    model: 'google/gemma-3-4b-it',
    mode: 'ungrounded',
    route: 'openrouter',
    providerOrder: ['deepinfra/bf16'],
    control: true,
  },
] as const

/**
 * The grounded-indexer twins (docs/LASSO.md §9a): the same model + route + provider pin
 * as their ungrounded counterpart, differing ONLY in mode — so the grounded-vs-ungrounded
 * Brier delta per model isolates the value of the injected articles.
 *
 * Free-or-almost-free by policy: Qwen rides Bedrock (AWS credits), DeepSeek and Gemini
 * Flash are the two cheapest OpenRouter members. Grok is deliberately absent (it alone
 * is ~80% of panel token cost) and the control stays ungrounded — a grounded control
 * would no longer falsify the same instrument.
 *
 * These members join a forecast's roster only when grounding is configured AND the
 * forecast carries the scope tag — see `runPanelSweep`.
 */
export const GROUNDED_PANEL_MEMBERS: readonly PanelMember[] = [
  {
    model: 'qwen.qwen3-235b-a22b-2507-v1:0',
    mode: 'grounded-indexer',
    route: 'bedrock',
  },
  {
    model: 'deepseek/deepseek-chat',
    mode: 'grounded-indexer',
    route: 'openrouter',
    providerOrder: ['deepinfra/fp4'],
  },
  {
    model: 'google/gemini-2.5-flash',
    mode: 'grounded-indexer',
    route: 'openrouter',
    providerOrder: ['google-vertex/eu'],
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

/**
 * Short human label for a member on the chart legend. Keyed by prefix so a version
 * bump (grok-4.3 → grok-4.4, or the Bedrock qwen id) keeps its label without an edit.
 * Falls back to the raw slug so a new member is never unlabelled.
 */
export function panelMemberLabel(model: string): string {
  if (model.startsWith('qwen')) return 'Qwen'
  if (model.startsWith('deepseek')) return 'DeepSeek'
  if (model.startsWith('google/gemini')) return 'Gemini'
  if (model.startsWith('google/gemma')) return 'Gemma'
  if (model.startsWith('x-ai/grok')) return 'Grok'
  if (model.startsWith('openai/')) return 'GPT'
  return model
}

/**
 * Whether a model id is the roster's deliberately-weak control member. The single
 * source of truth is the roster's `control` flag — callers must not re-derive this
 * from model-name prefixes, or swapping the control model silently mislabels it.
 */
export function isControlModel(model: string, members: readonly PanelMember[] = PANEL_MEMBERS): boolean {
  return members.some((m) => m.control === true && m.model === model)
}

/**
 * A distinct, stable colour per member for the dashed panel lines. Deliberately not
 * the Oracle's amber (#FBBF24), the community blue, or the market pink — the panel is
 * its own source. Indexed by roster position so colours don't shuffle when a member
 * abstains on a given run.
 */
export const PANEL_MEMBER_COLORS = ['#22D3EE', '#A78BFA', '#F472B6', '#4ADE80', '#FB923C'] as const

export function panelMemberColor(model: string, members: readonly PanelMember[] = PANEL_MEMBERS): string {
  const i = members.findIndex((m) => m.model === model)
  if (i >= 0) return PANEL_MEMBER_COLORS[i % PANEL_MEMBER_COLORS.length]
  // Retired members (historical rows whose model left the roster) get a stable
  // hash-derived colour instead of all collapsing onto index 0 — otherwise a renamed
  // member (qwen/… → qwen.…) charts two identical-colour lines.
  let hash = 0
  for (let c = 0; c < model.length; c++) hash = (hash * 31 + model.charCodeAt(c)) >>> 0
  return PANEL_MEMBER_COLORS[hash % PANEL_MEMBER_COLORS.length]
}

/** Grounded twins keep their ungrounded sibling's hue family, one shade deeper, so the
 *  pairing is readable on the chart without the two lines being indistinguishable. */
export const GROUNDED_MEMBER_COLORS = ['#0891B2', '#7C3AED', '#DB2777'] as const

/**
 * Colour for one chart/leaderboard series, keyed by the FULL member identity axis the
 * chart draws on. `panelMemberColor` alone would give a grounded twin the same colour
 * as its ungrounded sibling — two same-colour dashed lines on one forecast.
 */
export function panelSeriesColor(model: string, mode: string): string {
  if (mode !== 'grounded-indexer') return panelMemberColor(model)
  const i = GROUNDED_PANEL_MEMBERS.findIndex((m) => m.model === model)
  if (i >= 0) return GROUNDED_MEMBER_COLORS[i % GROUNDED_MEMBER_COLORS.length]
  let hash = 0
  for (let c = 0; c < model.length; c++) hash = (hash * 31 + model.charCodeAt(c)) >>> 0
  return GROUNDED_MEMBER_COLORS[hash % GROUNDED_MEMBER_COLORS.length]
}

/** Legend/leaderboard label for a member identity: the model's short name, with the
 *  grounded twin marked. "(news)" not "(grounded)" — viewers shouldn't need the jargon. */
export function panelSeriesLabel(model: string, mode: string): string {
  const base = panelMemberLabel(model)
  return mode === 'grounded-indexer' ? `${base} (news)` : base
}
