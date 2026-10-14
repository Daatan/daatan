import { getPromptTemplate, fillPrompt } from './bedrock-prompts'
import { llmService } from './index'
import { rulesStrengthSchema } from './schemas'
import { forStage } from './stageModels'
import { createLogger } from '@/lib/logger'

const log = createLogger('rules-strength')

export const RULES_WEAKENING_KINDS = ['announcement', 'intent', 'partial', 'scope', 'or_weak', 'other'] as const
export type RulesWeakeningKind = (typeof RULES_WEAKENING_KINDS)[number]

export type RulesStrengthOutcome = {
  /** `error` = the check itself failed (fail-open); `weaker` = rules resolve YES on an easier event than the claim. */
  verdict: 'ok' | 'weaker' | 'error'
  kind: RulesWeakeningKind | 'none'
  /** The weakest event the rules accept for YES, as the judge read it. */
  yesTrigger: string
  /** The judge's rewrite. Recorded only: nothing applies it yet (shadow, #1803). */
  fixedRules: string
}

const FAILED: RulesStrengthOutcome = { verdict: 'error', kind: 'none', yesTrigger: '', fixedRules: '' }

/**
 * Shadow check (#1803): do the resolution rules resolve YES on an event weaker than
 * the claim ("announces or implements" under a claim that says "requires")? Prompt rule
 * 9a alone moved this 29 -> 20 per 100 prod claims (not significant), so a separate
 * judge reads the finished claim/rules pair.
 *
 * Advisory and never throws: a failed call returns `verdict: 'error'`. The caller records
 * the outcome and leaves the rules untouched until the shadow data is read.
 */
export async function checkRulesStrength(claimText: string, resolutionRules: string): Promise<RulesStrengthOutcome> {
  if (!resolutionRules.trim()) return FAILED
  try {
    const template = await getPromptTemplate('rules-strength')
    const result = await llmService.generateContent({
      ...forStage('rules_strength'),
      prompt: fillPrompt(template, { claimText, resolutionRules }),
      schema: rulesStrengthSchema,
      temperature: 0,
    })
    const parsed = JSON.parse(result.text) as { yesTrigger?: string; weaker?: boolean; kind?: string; fixedRules?: string }
    const weaker = parsed.weaker === true
    const kind = RULES_WEAKENING_KINDS.find((k) => k === parsed.kind) ?? (weaker ? 'other' : 'none')
    if (weaker) log.info({ claimText, kind, yesTrigger: parsed.yesTrigger }, 'resolution rules accept a weaker event than the claim')
    return {
      verdict: weaker ? 'weaker' : 'ok',
      kind: weaker ? kind : 'none',
      yesTrigger: (parsed.yesTrigger ?? '').trim(),
      fixedRules: weaker ? (parsed.fixedRules ?? '').trim() : '',
    }
  } catch (err) {
    log.warn({ err }, 'rules-strength check failed')
    return FAILED
  }
}
