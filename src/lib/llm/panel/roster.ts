/**
 * The AI panel's members (docs/AI_PANEL.md §5).
 *
 * Deliberately data, not code: `AiEstimate.model` and `.mode` are stored as plain
 * strings, so adding or dropping a member is one entry here and no migration.
 * Per-member Brier is what decides who stays — don't agonize over the roster.
 */

/** Ungrounded = claim + dates + rules, no article text, no web search. */
export type PanelMode = 'ungrounded'

export interface PanelMember {
  /** OpenRouter slug. Stored verbatim as `AiEstimate.model`. */
  model: string
  mode: PanelMode
  /**
   * OpenRouter provider tags to pin, most-preferred first, with fallbacks off.
   *
   * Unpinned, OpenRouter routes a single slug to whichever backend is cheapest or
   * fastest right now — and those backends serve different quantizations (qwen3-235b
   * is fp8 on every provider, but which fp8 varies). Run-to-run variance would then
   * get misattributed to the model and quietly corrupt the per-member Brier
   * comparison that this whole feature exists to produce.
   *
   * Tags verified against https://openrouter.ai/api/v1/models/{slug}/endpoints.
   */
  providerOrder: string[]
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
  { model: 'qwen/qwen3-235b-a22b-2507', mode: 'ungrounded', providerOrder: ['deepinfra/fp8'] },

  { model: 'openai/gpt-5-mini', mode: 'ungrounded', providerOrder: ['openai'] },

  // google-vertex/eu keeps claim text in the EU, matching where the rest of the
  // stack runs (eu-central-1).
  { model: 'google/gemini-2.5-flash', mode: 'ungrounded', providerOrder: ['google-vertex/eu'] },

  { model: 'x-ai/grok-4.3', mode: 'ungrounded', providerOrder: ['xai'] },

  { model: 'openai/gpt-5-nano', mode: 'ungrounded', providerOrder: ['openai'], control: true },
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
