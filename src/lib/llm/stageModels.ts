import { createLogger } from '@/lib/logger'

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
] as const

export type LlmStage = (typeof LLM_STAGES)[number]

/**
 * `LLM_STAGE_MODELS="moderation=gemini-2.5-flash-lite,guess_chances=gemini-3.8-flash"`.
 * One env var rather than one per stage, so prod whitelists it once (compose +
 * blue-green ENV_ARGS). Unset or empty = every stage keeps its built-in model.
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

/** The configured model for `stage`, else `fallback` (undefined = the chain default). */
export function stageModel(stage: LlmStage, fallback: string): string
export function stageModel(stage: LlmStage, fallback?: string): string | undefined
export function stageModel(stage: LlmStage, fallback?: string): string | undefined {
  const raw = process.env.LLM_STAGE_MODELS
  if (!cached || cached.raw !== raw) cached = { raw, map: parseStageModels(raw) }
  return cached.map[stage] ?? fallback
}

/** Spread into an `llmService.generateContent` request: tags the stage, applies its model. */
export function forStage(stage: LlmStage, fallback?: string): { stage: LlmStage; model?: string } {
  const model = stageModel(stage, fallback)
  return model ? { stage, model } : { stage }
}
