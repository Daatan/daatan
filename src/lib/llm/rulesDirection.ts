import { getPromptTemplate, fillPrompt } from './bedrock-prompts'
import { llmService } from './index'
import { rulesDirectionSchema } from './schemas'
import { forStage } from './stageModels'
import { createLogger } from '@/lib/logger'

const log = createLogger('rules-direction')

export type RulesDirection = 'consistent' | 'inverted' | 'unclear'

export interface RulesDirectionOutcome {
  /** Verdict on the rules this returns; `error` = the check itself failed (fail-open). */
  direction: RulesDirection | 'error'
  /** Verdict on the rules it was given. */
  initial: RulesDirection | 'error'
  /** The rules to use: rewritten when `fixed`, else the input unchanged. */
  rules: string
  fixed: boolean
}

interface Verdict {
  direction: RulesDirection
  fixedRules: string
}

async function judge(claimText: string, resolutionRules: string): Promise<Verdict> {
  const template = await getPromptTemplate('rules-direction')
  const result = await llmService.generateContent({
    ...forStage('rules_direction'),
    prompt: fillPrompt(template, { claimText, resolutionRules }),
    schema: rulesDirectionSchema,
    temperature: 0,
  })
  const parsed = JSON.parse(result.text) as Partial<Verdict>
  const direction = parsed.direction === 'inverted' || parsed.direction === 'unclear' ? parsed.direction : 'consistent'
  return { direction, fixedRules: (parsed.fixedRules ?? '').trim() }
}

/**
 * Makes sure a binary forecast's resolution rules resolve YES when its claim is true
 * (#1813). The #1802 audit found 6 of 236 live forecasts whose rules pointed the other
 * way, mostly a negated claim ("X will not happen") with rules written for X.
 *
 * One call in the common case. When the rules are inverted, the same call returns a
 * rewrite; it is used only if a second check calls it consistent, otherwise the input
 * comes back with `direction: 'inverted'` for the caller to act on. Never throws: the
 * check is advisory and must not block creation, so a failed call returns the input.
 */
export async function ensureRulesDirection(claimText: string, resolutionRules: string): Promise<RulesDirectionOutcome> {
  if (!resolutionRules.trim()) {
    return { direction: 'unclear', initial: 'unclear', rules: resolutionRules, fixed: false }
  }
  let first: Verdict
  try {
    first = await judge(claimText, resolutionRules)
  } catch (err) {
    log.warn({ err }, 'rules-direction check failed; keeping the rules as generated')
    return { direction: 'error', initial: 'error', rules: resolutionRules, fixed: false }
  }
  if (first.direction !== 'inverted') {
    if (first.direction === 'unclear') log.info({ claimText }, 'rules never state a YES condition')
    return { direction: first.direction, initial: first.direction, rules: resolutionRules, fixed: false }
  }

  if (first.fixedRules) {
    try {
      const second = await judge(claimText, first.fixedRules)
      if (second.direction === 'consistent') {
        log.info({ claimText }, 'inverted resolution rules rewritten')
        return { direction: 'consistent', initial: 'inverted', rules: first.fixedRules, fixed: true }
      }
    } catch (err) {
      log.warn({ err }, 'rules-direction re-check failed')
    }
  }
  log.warn({ claimText }, 'resolution rules still resolve YES on the opposite of the claim')
  return { direction: 'inverted', initial: 'inverted', rules: resolutionRules, fixed: false }
}
