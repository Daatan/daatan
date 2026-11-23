/**
 * Validates the model registry (daatan#2287): what CI checks when someone changes a model,
 * a provider leg or a param in registry.ts. The panel's Terraform grants are checked in
 * panel/__tests__/roster.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { applyQuirks, RejectedParamError } from '../quirks'
import {
  CHAIN,
  GROUNDED_PANEL_MEMBERS,
  MODEL_QUIRKS,
  normalizeModelId,
  PANEL_MEMBERS,
  PANEL_PARAMS,
  STAGES,
  type ModelParam,
  type ModelParams,
} from '../registry'
import { LLM_STAGES, stageModel, type LlmStage } from '../stageModels'
import { scanSource } from './goldens/callSites'

const paramsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    reasoningBudget: z.number().int().min(0).optional(),
    maxTokens: z.number().int().positive().optional(),
    googleSearch: z.boolean().optional(),
  })
  .strict()

const stages = Object.entries(STAGES) as [LlmStage, (typeof STAGES)[LlmStage]][]

/** The models a stage's request can reach: its primary, then every non-Google chain leg. */
function stageModels(stage: LlmStage): string[] {
  if (stage === 'grounded_date') return [stageModel(stage)]
  return [stageModel(stage), ...CHAIN.filter((l) => l.provider !== 'google').map((l) => l.model)]
}

function quirkProblems(where: string, model: string, params: ModelParams, force: readonly ModelParam[] = []): string[] {
  try {
    applyQuirks(model, params, force)
    return []
  } catch (err) {
    if (err instanceof RejectedParamError) return [`${where}: ${err.message}`]
    throw err
  }
}

describe('model registry (daatan#2287)', () => {
  it('has exactly one entry per stage', () => {
    expect(Object.keys(STAGES).sort()).toEqual([...LLM_STAGES].sort())
  })

  it('params and timeouts are in range', () => {
    for (const [stage, entry] of stages) {
      expect(paramsSchema.safeParse(entry.params).success, `stage ${stage}`).toBe(true)
      if (entry.timeoutMs !== undefined) expect(Number.isInteger(entry.timeoutMs) && entry.timeoutMs > 0, `stage ${stage}`).toBe(true)
    }
    expect(paramsSchema.safeParse(PANEL_PARAMS).success).toBe(true)
  })

  it('grounded_date has its own timeout (its lookup aborts on it)', () => {
    expect(STAGES.grounded_date.timeoutMs).toBeGreaterThan(0)
  })

  it("a stage's own primary is a Google model until per-stage legs exist", () => {
    const off = stages.filter(([, e]) => e.primary && e.primary.provider !== 'google').map(([s]) => s)
    expect(off, 'a per-stage primary on another provider needs the per-stage leg adapter first').toEqual([])
  })

  it("a stage's own primary takes every param the stage sets", () => {
    // A quirk may drop a param on a fallback or on the chain model (the rollback path), but
    // a stage that names its own model chose it for those params (daatan#2290).
    for (const [stage, entry] of stages) {
      if (!entry.primary) continue
      expect(applyQuirks(entry.primary.model, entry.params, entry.force), `stage ${stage} on ${entry.primary.model}`).toEqual(entry.params)
    }
  })

  it('the chain has one leg per provider, Google first', () => {
    expect(CHAIN[0].provider).toBe('google')
    expect(new Set(CHAIN.map((l) => l.provider)).size).toBe(CHAIN.length)
  })

  it('no role sends a param its model rejects', () => {
    const problems = [
      ...stages.flatMap(([stage, entry]) =>
        stageModels(stage).flatMap((model) => quirkProblems(`stage ${stage}`, model, entry.params, entry.force)),
      ),
      ...[...PANEL_MEMBERS, ...GROUNDED_PANEL_MEMBERS].flatMap((m) => quirkProblems(`panel ${m.model}`, m.model, PANEL_PARAMS)),
    ]
    expect(problems).toEqual([])
  })

  it("no quirk gives a main-chain model maxTokens, which the chain doesn't send yet", () => {
    const chainModels = new Set(stages.flatMap(([stage]) => stageModels(stage)))
    const bad = [...chainModels].filter((m) => {
      const rules = MODEL_QUIRKS[normalizeModelId(m)] ?? {}
      return Object.values(rules).some((r) => r?.rule === 'rename' && r.to === 'maxTokens')
    })
    expect(bad).toEqual([])
  })

  it('every quirk has a note, a normalised key and a real rename target', () => {
    for (const [model, rules] of Object.entries(MODEL_QUIRKS)) {
      expect(normalizeModelId(model), `key ${model}`).toBe(model)
      for (const [param, rule] of Object.entries(rules)) {
        expect(rule?.note.trim(), `${model}.${param}`).toBeTruthy()
        if (rule?.rule === 'rename') expect(rule.to, `${model}.${param}`).not.toBe(param)
      }
    }
  })

  it('force names only params the stage sets', () => {
    for (const [stage, entry] of stages) {
      for (const param of entry.force ?? []) expect(entry.params[param as keyof typeof entry.params], `stage ${stage} forces ${param}`).toBeDefined()
    }
  })

  it("an eval pin matches the model the stage runs — re-run the eval after a swap", () => {
    for (const [stage, entry] of stages) {
      if (entry.evalResult) expect(entry.evalResult.model, `stage ${stage}: ${entry.eval ?? 'no eval named'}`).toBe(stageModel(stage))
    }
  })

  it('staged call sites leave model, params and timeout to the registry', () => {
    const owned = new Set(['model', 'temperature', 'thinkingBudget', 'googleSearch', 'googleTimeoutMs', 'forceParams'])
    const offenders = scanSource()
      .calls.filter((c) => c.stage !== '(unstaged)')
      .flatMap((c) => [
        ...Object.keys(c.params).filter((k) => owned.has(k)).map((k) => `${c.file} (${c.stage}) sets ${k}`),
        ...(c.fallback ? [`${c.file} (${c.stage}) passes a model to forStage`] : []),
      ])
    expect(offenders).toEqual([])
  })
})
