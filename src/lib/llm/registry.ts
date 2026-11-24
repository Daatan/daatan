/**
 * The model registry (daatan#2287, umbrella Daatan/platform#60): every model this app calls,
 * on which provider, with which params. Changing one is an edit here, and
 * `__tests__/registry.test.ts` checks the edit (params a model can't take, eval pins,
 * Terraform grants for the panel's Bedrock members). Same shape as retro's and
 * news-indexer's `models.yaml`: model quirks, the main chain, stages, the panel.
 *
 * Deliberately NOT here — documented runtime choices:
 * - each bot's `modelPreference` (DB, admin-editable), read by `createBotLLMService`, and
 *   everything that runs on it: the bot runner and the admin bot-config generation call.
 *   New bots' default preference sits in `src/agents/bots/*`, the admin bots route and the
 *   Prisma schema; the bot chain's fallbacks are this file's chain models;
 * - the self-host edition's OpenRouter model (admin setting → `OPENROUTER_MODEL` →
 *   `SELF_HOST_OPENROUTER_DEFAULT` below), which replaces the chain's OpenRouter leg there;
 * - the Ibi tool's model menu (`components/ibi/IbiTool.tsx`): the user picks per request;
 * - `primaryOnly`, a call-site argument, because it depends on the caller;
 * - embeddings (`services/embedding.ts`): changing that model means re-embedding every row.
 * Still read from env until a follow-up PR drops them: `LLM_STAGE_MODELS` (a stage's Google
 * model) and `EVIDENCE_SECOND_OPINION_MODEL`. Both win over this file while they exist.
 * Empty in the prod container (checked 2026-11-23); the staging bundle gets checked before
 * they go.
 */
import type { PanelMember } from './panel/roster'
import type { QuirkHookName } from './quirks'
import type { LlmStage } from './stageModels'

// ─── Params and model quirks ────────────────────────────────────────────────────────────

/** A provider-neutral call param. Each adapter maps it to its own wire name. */
export type ModelParam = 'temperature' | 'reasoningBudget' | 'maxTokens' | 'googleSearch'

export interface ModelParams {
  temperature?: number
  /** Thinking / reasoning budget in tokens; 0 = off. Unset = the model's own default. */
  reasoningBudget?: number
  /** Output token cap. */
  maxTokens?: number
  /** Ground the call with Google Search (daatan#2290). Only the Vertex leg has the tool;
   *  every other leg ignores it and sends the plain prompt. */
  googleSearch?: boolean
}

/**
 * What to do when a role sends `param` to a model that can't take it as is (Q5 of
 * daatan#2287). No entry = `ok`: sent unchanged. A role can override `ignore`, `rename`
 * and `hook` with `force: [param]`; `reject` can't be forced, and the registry test fails
 * on any role that would send a rejected param.
 * - `ignore`: dropped before the call.
 * - `reject`: never valid; the role must not set it.
 * - `rename`: sent as another neutral param instead.
 * - `hook`: a named function in `quirks.ts`, for what no rule can express.
 */
export type QuirkRule<Hook extends string = QuirkHookName> =
  | { rule: 'ok'; note: string }
  | { rule: 'ignore'; note: string }
  | { rule: 'reject'; note: string }
  | { rule: 'rename'; to: ModelParam; note: string }
  | { rule: 'hook'; hook: Hook; note: string }

/**
 * Model quirks, keyed by the normalised id (see `normalizeModelId`): `bedrock/`,
 * `vertex_ai/`, `google/` and a `us.`/`eu.`/`apac.`/`global.` inference-profile prefix
 * removed, so one entry covers every route to the same model.
 */
export const MODEL_QUIRKS: Readonly<Record<string, Partial<Record<ModelParam, QuirkRule>>>> = {
  'gemini-2.5-flash': {
    googleSearch: {
      rule: 'ignore',
      note: 'Google Search together with a responseSchema answers HTTP 400 on 2.5 (probed 2026-11-23, daatan#2290); 3.5-flash, 3.5-flash-lite and 3.6–3.8-flash take both. Every chain stage that searches sends a schema, so on 2.5 the call runs without search. The grounded-date lookup searches on 2.5 without a schema, outside the chain.',
    },
  },
  'xai.grok-4.7': {
    temperature: {
      rule: 'ignore',
      note: 'Bedrock Grok 4.6/4.7 answers HTTP 400 to `temperature` (measured 2026-11-23, daatan#2283). It also cannot turn reasoning off, which is why the panel does not use it.',
    },
  },
}

export function normalizeModelId(id: string): string {
  return id.replace(/^(bedrock|vertex_ai|google)\//, '').replace(/^(us|eu|apac|global)\./, '')
}

// ─── Main chain (`llmService`) ──────────────────────────────────────────────────────────

/**
 * `google` is the Vertex leg, then the Gemini API-key leg (self-host); each registers only
 * when configured, like every leg here.
 */
export type ChainProvider = 'google' | 'oracle' | 'openrouter' | 'ollama'

export interface ChainLeg {
  provider: ChainProvider
  model: string
  note: string
}

/** The shared chain, in the order it is tried. A failing leg falls through to the next. */
export const CHAIN: readonly ChainLeg[] = [
  {
    provider: 'google',
    model: 'gemini-2.5-flash',
    note: 'Both Google legs use this model, so they cannot silently diverge. A stage can set its own (`primary` below).',
  },
  {
    provider: 'oracle',
    // Pinned rather than inheriting the Oracul's own default.
    model: 'bedrock/amazon.nova-pro-v1:0',
    note: "The Oracul's /llm, on AWS Bedrock: a different vendor from Google, so it serves exactly when Google is down. Only when ORACLE_URL + ORACLE_API_KEY are set.",
  },
  {
    provider: 'openrouter',
    // Paid id: the `:free` tier of this model was withdrawn and its old id is no longer
    // served (daatan#2282). At this leg's volume (0 calls in the 30 days to 2026-11-20)
    // the cost is negligible; it shares the OpenRouter key and its balance with Jev.
    model: 'meta-llama/llama-3.3-70b-instruct',
    note: 'SaaS last-resort backstop, and the bots\' fallback too. Must not be a Google model: it would die in the same outage. Self-host replaces it with the admin-chosen model.',
  },
  {
    provider: 'ollama',
    model: 'qwen2.5:7b',
    note: 'Only when OLLAMA_BASE_URL is set, so hosts without Ollama carry no dead leg.',
  },
]

/** The self-host edition's OpenRouter model when neither the admin setting nor
 *  `OPENROUTER_MODEL` names one (`getOpenRouterModel`). */
export const SELF_HOST_OPENROUTER_DEFAULT = 'openai/gpt-5-mini'

/** The model of the chain's `provider` leg. */
export function chainModel(provider: ChainProvider): string {
  const leg = CHAIN.find((l) => l.provider === provider)
  if (!leg) throw new Error(`model registry: the chain has no ${provider} leg`)
  return leg.model
}

// ─── Stages ─────────────────────────────────────────────────────────────────────────────

export interface StageEntry {
  /**
   * The stage's own primary model, instead of the chain's first leg. Only `google` for
   * now: a per-stage leg on another provider needs the per-stage adapter (daatan#2287,
   * next PR), and the registry test refuses it until then.
   */
  primary?: { provider: ChainProvider; model: string }
  /** `maxTokens` is not wired on the main chain yet. */
  params: Pick<ModelParams, 'temperature' | 'reasoningBudget' | 'googleSearch'>
  /** Params sent even where a model quirk says otherwise. */
  force?: ModelParam[]
  /** The primary leg's timeout in ms; unset = the provider default (Google legs: 30 s). */
  timeoutMs?: number
  note?: string
  /** How to re-measure the stage after a model change. */
  eval?: string
  /** The model the last eval ran on. The registry test fails once the stage's model differs. */
  evalResult?: { model: string; ref: string }
}

/** Every `llmService` call site by stage (#1800). `temperature: 0` = deterministic. */
export const STAGES: Readonly<Record<LlmStage, StageEntry>> = {
  express_draft: {
    params: { temperature: 0.2, reasoningBudget: 512 },
    note:
      "Thinking capped for the draft (#1890 option B). Default (dynamic) thinking spent ~1,300 tokens and made the draft the slowest creation stage: bench on 16 polarity cases x 3, p50 7.5 s / p90 16.4 s / max 26.6 s. At 512: p50 4.6 s / p90 5.4 s / max 6.0 s, no polarity flips, every claim in English. 0 is faster still but copied 9 of 48 non-English inputs verbatim instead of translating them. A searching draft (daatan#2290: `gemini-3.5-flash-lite` with `googleSearch`, one call, no lookup) is wired but off: in confirm runs 2 and 3 (scripts/eval-express-grounded.ts, its `search` arm vs this entry, 55 date drafts each) it was 4-5x faster (p90 ~3.5 s vs 15 s) with as many dates in range (44 vs 40, 44 vs 44) but more confidently wrong ones (3 vs 0, 5 vs 4), nearly all a government-formation deadline taken from the first mandate. To switch: `primary` Flash-Lite, `googleSearch: true`, drop `reasoningBudget` (512 made Flash-Lite skip search), re-run that eval, `UPDATE_GOLDENS=1`.",
    eval: 'scripts/eval-express-grounded.ts, scripts/check-express-polarity.ts',
    evalResult: { model: 'gemini-2.5-flash', ref: 'daatan#2290 confirm run 3, rollback arm' },
  },
  express_topic: { params: { temperature: 0 } },
  guess_chances: { params: { temperature: 0 } },
  moderation: { params: { temperature: 0 }, eval: 'scripts/check-moderation-regression.ts' },
  tags: { params: { temperature: 0 } },
  prediction_extract: { params: { temperature: 0 } },
  translation: { params: { temperature: 0 } },
  translation_detect: { params: { temperature: 0 } },
  search_query: {
    params: { temperature: 0, reasoningBudget: 0 },
    note: 'Thinking off for the query extraction (daatan#1890).',
  },
  context_summary: { params: { temperature: 0 } },
  ai_estimate: { params: { temperature: 0 } },
  temporal_classifier: { params: { temperature: 0 } },
  relation_typer: { params: { temperature: 0 } },
  backfill_rules: { params: { temperature: 0 } },
  research_queries: { params: { temperature: 0 } },
  research_verdict: {
    primary: { provider: 'google', model: 'gemini-2.5-pro' },
    params: { temperature: 0 },
    timeoutMs: 75_000,
    note:
      "The strongest Gemini tier: resolution research is low-volume (rate-limited per user) and exactly the multi-source rules-reasoning task where pro beats flash. Query generation stays on the chain default; non-Google fallback legs keep their own models. Timeout #2096: the 30 s default cut Pro off in 3 of 15 prod verdicts, and its slowest success took 27.5 s. nginx allows 120 s for /api/, and this has to leave room for the search before it.",
    eval: 'scripts/check-conjunction-resolution.ts',
  },
  grounded_date: {
    params: { temperature: 0 },
    timeoutMs: 15_000,
    note:
      'Not on the chain: one Vertex call with the googleSearch tool (groundedDateLookup.ts). Timeout measured 4.4–10.4 s (2026-09-18); p50 4.4 s / p90 8.4 s on 28 calls (2026-11-02, #1890). Raised from 10 s (daatan#2199): every `unavailable` in prod 2026-10-16..11-15 (4/4) was this timeout. A thinking cap cost accuracy for ~0.3 s, so the slow tail is cut by the timeout instead.',
  },
  headline: { params: { temperature: 0 }, eval: 'scripts/check-headline-tense.ts' },
  rules_direction: { params: { temperature: 0 }, eval: 'scripts/check-rules-direction.ts' },
  rules_strength: { params: { temperature: 0 } },
  claim_definedness: { params: { temperature: 0 } },
  retro_event_judge: { params: { temperature: 0 } },
  retro_event_check: {
    params: { temperature: 0 },
    timeoutMs: 25_000,
    note:
      "The Google leg's own limit, below its 30 s default, so the fallback (which also stops at CHECK_TIMEOUT_MS, 35 s) keeps about twice the 5 s it took (daatan#2229).",
  },
  topic_suggest: {
    params: { temperature: 0 },
    timeoutMs: 60_000,
    note:
      'One call a run over every multi-source cluster of the week plus the open forecasts they touch (daatan#2308), so the input is large (~15k tokens) and the answer long. 60 s on Vertex; the service caps the whole run at 100 s (RUN_BUDGET_MS), so an Oracul fallback after a Vertex timeout is cut short before the 118 s curl limit of the workflow.',
  },
}

// ─── One-off roles ──────────────────────────────────────────────────────────────────────

/**
 * The expensive re-extraction model for evidence second opinions, sent to the Oracul's
 * /forecast as `model` — retro's own registry then applies that model's quirks.
 */
export const EVIDENCE_SECOND_OPINION = {
  provider: 'oracle',
  model: 'bedrock/us.anthropic.claude-sonnet-5-5',
} as const

// ─── AI panel (docs/LASSO.md §5) ────────────────────────────────────────────────────────

/**
 * One cheap integer per member, deterministic, no hidden thinking: temperature 0, reasoning
 * off, and a 64-token cap so a model that ignores the off switch can't think out loud on
 * our bill (Gemini prices internal reasoning at the output rate). Bedrock Converse has no
 * generic reasoning switch, so every Bedrock member must be a model that doesn't reason.
 */
export const PANEL_PARAMS: Readonly<ModelParams> = { temperature: 0, maxTokens: 64, reasoningBudget: 0 }
export const PANEL_TIMEOUT_MS = 30_000

/**
 * The Vertex Gemini member's model, shared by the ungrounded member and its grounded
 * twin. Deliberately NOT a main-chain model constant: the main chain can use a thinking
 * model, the panel can't. Verified 2026-10-03 (daatan#1763): Flash-Lite answers inside
 * the 64-token cap with zero thought tokens; gemini-3.8-flash spends the whole cap
 * thinking and returns nothing. Price-identical to the gemini-2.5-flash it replaces
 * ($0.30 / $2.50 per 1M on Vertex global).
 */
export const VERTEX_PANEL_MODEL = 'google/gemini-3.5-flash-lite'

/** The second Bedrock region: models with no eu-central-1 deployment run here. Extraction
 *  and settlement verification already run in us-east-1 (retro#548), so this adds no new
 *  data-residency exposure. */
export const BEDROCK_US_REGION = 'us-east-1'

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
  // is a strong independent lineage (distinct from Alibaba/Google/xAI).
  //
  // Was `deepseek/deepseek-chat` (DeepSeek V3, Dec 2024) on OpenRouter until daatan#2283:
  // that route is paid from a personal balance, and its 402s silenced this member from
  // 2026-11-17. Bedrock serves no V3, so this is also a model upgrade — a new member, a
  // fresh Brier series. us-east-1 because Bedrock has no eu-central-1 deployment of it.
  // Verified 2026-11-23 (real prompt, temperature 0, 64 tokens): 6/6 answered with a
  // bare `{"probability": N}` in a single text block, 7 output tokens, no reasoning.
  {
    model: 'deepseek.v3.2',
    mode: 'ungrounded',
    route: 'bedrock',
    region: BEDROCK_US_REGION,
  },

  // Direct Vertex (daatan#1513), not proxied through OpenRouter, authenticated with
  // the app's own service account. The id keeps the `google/` OpenRouter-style prefix
  // (client.ts strips it for the endpoint). This is NOT a stack-wide residency
  // guarantee — extraction and settlement verification (the calls that actually
  // carry article/claim text) run on Bedrock in us-east-1 (retro#548).
  //
  // Was google/gemini-2.5-flash until daatan#1763 (Vertex stops serving 2.5 on
  // 2027-03-31). Flash-LITE, not Flash, on purpose: Gemini 3.x Flash cannot turn its
  // thinking off (budget 0 ignored, MINIMAL rejected), and the panel is
  // no-hidden-thinking by construction — see VERTEX_PANEL_MODEL. A new member: its
  // Brier series starts fresh, and the roster signature change forces a new sweep.
  {
    model: VERTEX_PANEL_MODEL,
    mode: 'ungrounded',
    route: 'vertex',
  },

  // Replaced `x-ai/grok-4.3`, the last OpenRouter member (daatan#2283): that route is
  // paid from a personal balance, and Bedrock serves only Grok 4.6/4.7, which this panel
  // excludes by design — measured 2026-11-23, Grok 4.7 rejects `temperature`, always
  // reasons, and on two of three real claims spent the whole budget on reasoning at both
  // 64 and 1,024 tokens, with or without `low` effort. Mistral keeps a fifth independent
  // lineage (European, distinct from Alibaba/DeepSeek/Google). Verified 2026-11-23 (real
  // prompt, temperature 0, 64 tokens): 6/6 answered inside a ```json fence, 11–16 output
  // tokens, no reasoning, and `null` on the deliberately vague claim.
  {
    model: 'mistral.mistral-large-3-675b-instruct',
    mode: 'ungrounded',
    route: 'bedrock',
    region: BEDROCK_US_REGION,
  },

  // Was openai/gpt-5-nano (same reasoning-mandatory 400 as gpt-5-mini). The control is
  // deliberately WEAK — if it ties the strong members on Brier, the instrument is not
  // measuring anything. A 4B open-weights model is a cleaner control than a mini
  // frontier model ever was.
  //
  // Same weights as the `google/gemma-3-4b-it` it replaces on OpenRouter (daatan#2283),
  // but a new id on a new route, so a new series — see `model` above. Verified
  // 2026-11-23: 6/6 answered, always inside a ```json fence (13 output tokens), which
  // `extractJsonObject` unwraps.
  {
    model: 'google.gemma-3-4b-it',
    mode: 'ungrounded',
    route: 'bedrock',
    region: BEDROCK_US_REGION,
    control: true,
  },
] as const

/**
 * The grounded-indexer twins (docs/LASSO.md §9a): the same model + route + provider pin
 * as their ungrounded counterpart, differing ONLY in mode — so the grounded-vs-ungrounded
 * Brier delta per model isolates the value of the injected articles.
 *
 * Free-or-almost-free by policy: Qwen and DeepSeek ride Bedrock (AWS credits), Gemini
 * Flash-Lite rides Vertex (GCP credits, daatan#1513). Grok is deliberately absent (it
 * alone was ~80% of panel token cost) and the control stays ungrounded — a grounded
 * control would no longer falsify the same instrument.
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
    model: 'deepseek.v3.2',
    mode: 'grounded-indexer',
    route: 'bedrock',
    region: BEDROCK_US_REGION,
  },
  {
    model: VERTEX_PANEL_MODEL,
    mode: 'grounded-indexer',
    route: 'vertex',
  },
] as const
