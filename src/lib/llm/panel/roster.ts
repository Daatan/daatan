/**
 * The AI panel's members (docs/LASSO.md §5).
 *
 * Deliberately data, not code: `AiEstimate.model` and `.mode` are stored as plain
 * strings, so adding or dropping a member is one entry here and no migration.
 * Per-member Brier is what decides who stays — don't agonize over the roster.
 *
 * The roster data itself lives in `../registry.ts` (daatan#2287); this file keeps the
 * member type and the helpers.
 */
import { GROUNDED_PANEL_MEMBERS, PANEL_MEMBERS } from '../registry'

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
 *
 * `vertex` members use the app's Google service account (daatan#1472, daatan#1513) —
 * same Google backend as an OpenRouter `google-vertex/*` pin, but authenticated and
 * billed directly rather than proxied and marked up, and immune to an OpenRouter-wide
 * outage (401 key death, 402 credit exhaustion) the same way `bedrock` is.
 */
export type PanelRoute = 'openrouter' | 'bedrock' | 'vertex'

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
   * AWS region for a `route: 'bedrock'` member; defaults to the app's own region
   * (`AWS_REGION`, eu-central-1). Ignored for other routes. Needed because Bedrock does
   * not serve every model everywhere — DeepSeek V3.2 and Gemma 3 4B have no
   * eu-central-1 deployment (daatan#2283). terraform/bedrock_invoke.tf grants each
   * member in exactly this region.
   */
  region?: string
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

// The roster itself lives in the model registry (daatan#2287): one file for every model.
export { BEDROCK_US_REGION, GROUNDED_PANEL_MEMBERS, PANEL_MEMBERS, VERTEX_PANEL_MODEL } from '../registry'

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
 * bump (deepseek V3 → V3.2, or the Bedrock qwen id) keeps its label without an edit.
 * Falls back to the raw slug so a new member is never unlabelled.
 */
export function panelMemberLabel(model: string): string {
  // Bedrock ids use `vendor.model` (and a `global.`/`us.` prefix for an inference
  // profile) where OpenRouter slugs use `vendor/model`; retired rows carry either form.
  const id = model.replace(/^(global|us|eu|apac)\./, '').replace('.', '/')
  if (id.startsWith('qwen')) return 'Qwen'
  if (id.startsWith('deepseek')) return 'DeepSeek'
  if (id.startsWith('google/gemini')) return 'Gemini'
  if (id.startsWith('google/gemma')) return 'Gemma'
  if (id.startsWith('x-ai/grok') || id.startsWith('xai/grok')) return 'Grok'
  if (id.startsWith('mistral')) return 'Mistral'
  if (id.startsWith('openai/')) return 'GPT'
  return model
}

/**
 * Controls that have left the roster. Their historical rows are still a control's
 * series — the leaderboard must keep saying so, or a retired control that ties the
 * strong members reads as a strong member. Append here whenever `control` moves.
 */
const RETIRED_CONTROL_MODELS: readonly string[] = [
  'openai/gpt-5-nano',
  'google/gemma-3-4b-it', // → google.gemma-3-4b-it on Bedrock (daatan#2283)
]

/**
 * Whether a model id is (or was) the roster's deliberately-weak control member. The
 * source of truth is the roster's `control` flag plus `RETIRED_CONTROL_MODELS` —
 * callers must not re-derive this from model-name prefixes, or swapping the control
 * model silently mislabels it.
 */
export function isControlModel(model: string, members: readonly PanelMember[] = PANEL_MEMBERS): boolean {
  return members.some((m) => m.control === true && m.model === model) || RETIRED_CONTROL_MODELS.includes(model)
}

/**
 * A distinct, stable colour per member for the dashed panel lines. Deliberately not
 * the Oracul's amber (#FBBF24), the community blue, or the market pink — the panel is
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
