import { getPromptTemplate, fillPrompt } from './bedrock-prompts'
import { llmService } from './index'
import { claimDefinednessSchema } from './schemas'
import { forStage } from './stageModels'
import { createLogger } from '@/lib/logger'
import { detectScriptLanguage } from '@/lib/services/translation'

const log = createLogger('claim-definedness')

export const DEFINEDNESS_FAULTS = ['two_readings', 'rules_conflict'] as const
export type DefinednessFault = (typeof DEFINEDNESS_FAULTS)[number]

export type ClaimDefinednessOutcome = {
  /** `error` = the check itself failed (fail-open); `unclear` = the author is asked to resolve it. */
  verdict: 'ok' | 'unclear' | 'error'
  /** Whether `unclear` blocks publishing (DEFINEDNESS_BLOCKS_PUBLISH at the time of the check). */
  enforced: boolean
  fault: DefinednessFault | 'none'
  /** The deciding word or phrase, as the judge quoted it. */
  term: string
  /** Shown to the author, in their language. */
  question: string
  /** Corrected claims to pick from, in the author's language. Picking one re-drafts from it. */
  options: string[]
  /** An ordinary outcome the readings settle differently, or the conflict. Recorded, not shown. */
  splitOutcome: string
  splitChance: number
  readerShare: number
}

const AUTHOR_LANGUAGE_NAMES: Record<string, string> = { he: 'Hebrew', ru: 'Russian', ar: 'Arabic', fa: 'Persian', el: 'Greek' }

/** The language the author typed in, by name, for the question and options (English for Latin script). */
export function authorLanguageName(userInput: string): string {
  const code = detectScriptLanguage(userInput)
  return (code && AUTHOR_LANGUAGE_NAMES[code]) || 'English'
}

const FAILED: ClaimDefinednessOutcome = {
  verdict: 'error', enforced: false, fault: 'none', term: '', question: '', options: [], splitOutcome: '', splitChance: 0, readerShare: 0,
}

/**
 * Asked for any ambiguity, the judge flags about half of real forecasts, so its two
 * self-reported numbers gate the verdict. A two-readings fault needs a split outcome with a
 * real chance and a common second reading; a rules conflict must be literal (the rules name a
 * different number, party or event than the claim). Measured on prod forecasts in daatan#2166
 * (scripts/check-claim-definedness.ts): 7/72 (9.7%) of a holdout of real forecasts come out
 * unclear, about 3 of them genuinely.
 */
export const MIN_SPLIT_CHANCE = 50
export const MIN_READER_SHARE = 50
export const MIN_CONFLICT_SHARE = 100

/**
 * Whether an unclear verdict blocks publishing (true) or only shows the author the question
 * and the corrected claims (false). Off until the measured flag rate is accepted (#2166).
 */
export const DEFINEDNESS_BLOCKS_PUBLISH = false

export function definednessBlocks(v: { fault: string; splitChance: number; readerShare: number; options: string[] }): boolean {
  if (v.options.length < 2) return false
  if (v.fault === 'two_readings') return v.splitChance >= MIN_SPLIT_CHANCE && v.readerShare >= MIN_READER_SHARE
  if (v.fault === 'rules_conflict') return v.readerShare >= MIN_CONFLICT_SHARE
  return false
}

/**
 * daatan#2166: is the drafted forecast well-defined? A deciding term in the claim with two
 * common readings ("win" an election where the largest party may not form the government),
 * or rules that contradict the claim, put a question to the author with corrected claims to
 * pick from (and block publishing when DEFINEDNESS_BLOCKS_PUBLISH). Fails open: a failed call returns `verdict: 'error'` and never blocks.
 */
export async function checkClaimDefinedness(
  claimText: string,
  resolutionRules: string,
  /** What the author typed; only its script is read, to answer in the author's language. */
  authorText = '',
): Promise<ClaimDefinednessOutcome> {
  if (!claimText.trim() || !resolutionRules.trim()) return FAILED
  try {
    const language = authorLanguageName(authorText)
    const template = await getPromptTemplate('claim-definedness')
    const result = await llmService.generateContent({
      ...forStage('claim_definedness'),
      prompt: fillPrompt(template, { claimText, resolutionRules, language }),
      schema: claimDefinednessSchema,
      temperature: 0,
    })
    const parsed = JSON.parse(result.text) as Partial<Omit<ClaimDefinednessOutcome, 'verdict'>>
    const fault: ClaimDefinednessOutcome['fault'] = DEFINEDNESS_FAULTS.find((f) => f === parsed.fault) ?? 'none'
    const v = {
      fault,
      term: (parsed.term ?? '').trim(),
      question: (parsed.question ?? '').trim(),
      options: (parsed.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 3),
      splitOutcome: (parsed.splitOutcome ?? '').trim(),
      splitChance: Number(parsed.splitChance) || 0,
      readerShare: Number(parsed.readerShare) || 0,
    }
    const blocks = definednessBlocks(v)
    if (blocks) log.info({ claimText, fault, term: v.term, enforced: DEFINEDNESS_BLOCKS_PUBLISH }, 'claim is not well-defined')
    return { verdict: blocks ? 'unclear' : 'ok', enforced: blocks && DEFINEDNESS_BLOCKS_PUBLISH, ...v }
  } catch (err) {
    log.warn({ err }, 'claim-definedness check failed')
    return FAILED
  }
}
