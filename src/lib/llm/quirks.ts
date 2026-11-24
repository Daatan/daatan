/**
 * Applies the registry's model quirks (`MODEL_QUIRKS`) to a call's params, per model
 * (daatan#2287). Pure: every leg of the chain and every panel member runs its own params
 * through this right before building its request.
 */
import { MODEL_QUIRKS, normalizeModelId, type ModelParam, type ModelParams, type QuirkRule } from './registry'

type QuirkHook = (params: ModelParams) => ModelParams

/**
 * Code for a quirk no rule can express (e.g. "this model takes a reasoning effort level,
 * not a token budget"). A `hook` rule names an entry here.
 */
export const QUIRK_HOOKS = {} satisfies Record<string, QuirkHook>

export type QuirkHookName = keyof typeof QUIRK_HOOKS

export type QuirkTable = Readonly<Record<string, Partial<Record<ModelParam, QuirkRule<string>>>>>

export class RejectedParamError extends Error {}

/**
 * `params` as `model` should receive them. Returns the same object when no quirk applies,
 * so a caller can tell "unchanged" by identity.
 */
export function applyQuirks(
  model: string,
  params: ModelParams,
  force: readonly ModelParam[] = [],
  table: QuirkTable = MODEL_QUIRKS,
  hooks: Readonly<Record<string, QuirkHook>> = QUIRK_HOOKS,
): ModelParams {
  const rules = table[normalizeModelId(model)]
  if (!rules) return params
  let out = params
  for (const [param, rule] of Object.entries(rules) as [ModelParam, QuirkRule<string>][]) {
    if (params[param] === undefined || rule.rule === 'ok') continue
    if (rule.rule === 'reject') throw new RejectedParamError(`${model} does not take ${param}: ${rule.note}`)
    if (force.includes(param)) continue
    const next: ModelParams = { ...out }
    if (rule.rule === 'ignore') {
      delete next[param]
      out = next
    } else if (rule.rule === 'rename') {
      // Params differ in type (googleSearch is a flag): a rename between them is the table's error.
      ;(next as Record<ModelParam, unknown>)[rule.to] = params[param]
      delete next[param]
      out = next
    } else {
      out = hooks[rule.hook](next)
    }
  }
  return out
}
