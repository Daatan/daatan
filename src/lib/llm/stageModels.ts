import { createLogger } from '@/lib/logger'
import { chainModel, STAGES, type ModelParam } from './registry'

const log = createLogger('llm-stage-models')

/**
 * Every call site of the shared `llmService` chain, by stage (#1800). Before this, all of
 * them ran on the chain's one `GEMINI_MODEL` constant, so no stage could move alone.
 */
export const LLM_STAGES = [
  'express_draft',
  'express_topic',
  'guess_chances',
  'moderation',
  'tags',
  'prediction_extract',
  'translation',
  'translation_detect',
  'search_query',
  'context_summary',
  'ai_estimate',
  'temporal_classifier',
  'relation_typer',
  'backfill_rules',
  'research_queries',
  'research_verdict',
  'grounded_date',
  'headline',
  'rules_direction',
  'rules_strength',
  'claim_definedness',
  'retro_event_judge',
  'retro_event_check',
] as const

export type LlmStage = (typeof LLM_STAGES)[number]

/**
 * `LLM_STAGE_MODELS="moderation=gemini-2.5-flash-lite,guess_chances=gemini-3.8-flash"`.
 * One env var rather than one per stage, so prod whitelists it once (compose +
 * blue-green ENV_ARGS). Unset or empty = every stage keeps its registry model. Goes away
 * once the registry has been verified on the server (daatan#2287).
 * The value is a Google model id: it reaches the Vertex/Gemini legs only — the
 * non-Google fallback legs keep their pinned models (see LLMRequest.model).
 */
export function parseStageModels(raw: string | undefined): Partial<Record<LlmStage, string>> {
  const out: Partial<Record<LlmStage, string>> = {}
  if (!raw) return out
  for (const pair of raw.split(',')) {
    const [stage, model] = pair.split('=').map((s) => s?.trim())
    if (!stage || !model) continue
    if (!(LLM_STAGES as readonly string[]).includes(stage)) {
      log.warn({ stage }, 'LLM_STAGE_MODELS: unknown stage ignored')
      continue
    }
    out[stage as LlmStage] = model
  }
  return out
}

let cached: { raw: string | undefined; map: Partial<Record<LlmStage, string>> } | null = null

function envStageModel(stage: LlmStage): string | undefined {
  const raw = process.env.LLM_STAGE_MODELS
  if (!cached || cached.raw !== raw) cached = { raw, map: parseStageModels(raw) }
  return cached.map[stage]
}

/** Where a stage's model comes from — logged once at startup as `model_config`. */
export function stageModelSource(stage: LlmStage): 'env' | 'registry' {
  return envStageModel(stage) ? 'env' : 'registry'
}

/**
 * The stage's primary model: `LLM_STAGE_MODELS`, else its registry `primary`, else the
 * chain's Google model.
 */
export function stageModel(stage: LlmStage): string {
  return envStageModel(stage) ?? STAGES[stage].primary?.model ?? chainModel('google')
}

export interface StageRequest {
  stage: LlmStage
  model?: string
  temperature?: number
  thinkingBudget?: number
  googleTimeoutMs?: number
  forceParams?: ModelParam[]
}

/**
 * Spread into an `llmService.generateContent` request: tags the stage and applies its
 * registry entry (model, params, timeout). Call sites pass only the prompt, schema and
 * runtime arguments — the params live in `registry.ts` (daatan#2287).
 */
export function forStage(stage: LlmStage): StageRequest {
  const entry = STAGES[stage]
  if (entry.primary && entry.primary.provider !== 'google') {
    throw new Error(`model registry: stage ${stage} has a ${entry.primary.provider} primary, which needs the per-stage leg adapter (daatan#2287)`)
  }
  const model = envStageModel(stage) ?? entry.primary?.model
  const { temperature, reasoningBudget } = entry.params
  return {
    stage,
    ...(model ? { model } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningBudget !== undefined ? { thinkingBudget: reasoningBudget } : {}),
    ...(entry.timeoutMs !== undefined ? { googleTimeoutMs: entry.timeoutMs } : {}),
    ...(entry.force?.length ? { forceParams: entry.force } : {}),
  }
}
