import { createHash } from 'crypto'
import type { Schema } from '@google/generative-ai'
import { PROMPTS, type PromptName } from './bedrock-prompts'
import {
    botConfigGenerationSchema,
    forecastBatchSchema,
    queryGenerationSchema,
    researchSchema,
    rulesSchema,
    voteDecisionSchema,
} from './schemas'
import { expressPredictionSchema, guessChancesSchema } from './expressPrediction'
import { predictionSchema, suggestTagsSchema } from './gemini'
import { moderationSchema } from '@/lib/services/moderation'
import { relationTyperSchema } from '@/lib/services/relation-typer'
import { temporalClassifierSchema } from '@/lib/services/temporal-classifier'

/**
 * Which response schema ships with which prompt (#1658).
 *
 * A structured prompt is prose plus a schema whose `description` fields are
 * model-facing instructions — retro measured the schema at 27% of its extractor
 * prompt (retro#700). Here the two halves used to live in different systems
 * under separate change control, so neither version number described what the
 * model actually received. `prompts/prompt_versions.lock.json` pins both halves
 * of every entry below, and `promptLock.test.ts` fails when either moves without
 * the lock moving with it.
 *
 * `null` means the prompt is genuinely schema-free: its output contract is prose
 * (`forecast-quality-validation` asks for JSON and the caller regex-parses it),
 * or the reply is plain text (`dedupe-check` answers yes/no, `topic-extraction`
 * returns a phrase). Those entries still lock their prose.
 *
 * Total, not Partial, on purpose: adding a PromptName without deciding which
 * half of this it belongs to is a type error, which is the cheapest possible
 * moment to catch a new prompt that nothing watches.
 */
export const PROMPT_SCHEMAS: Record<PromptName, Schema | null> = {
    'express-prediction': expressPredictionSchema,
    'extract-prediction': predictionSchema,
    'suggest-tags': suggestTagsSchema,
    'update-context': null,
    'dedupe-check': null,
    'bot-forecast-generation': forecastBatchSchema,
    'bot-sourceless-forecast-generation': forecastBatchSchema,
    'forecast-quality-validation': null,
    'bot-vote-decision': voteDecisionSchema,
    'bot-config-generation': botConfigGenerationSchema,
    'research-query-generation': queryGenerationSchema,
    'resolution-research': researchSchema,
    'topic-extraction': null,
    'guess-chances': guessChancesSchema,
    'content-moderation': moderationSchema,
    'temporal-classifier': temporalClassifierSchema,
    'relation-typer': relationTyperSchema,
    'backfill-rules': rulesSchema,
    'panel-estimate': null,
    'panel-estimate-grounded': null,
}

/**
 * The schema's identifier, for the lock file and for anyone reading a failing
 * diff — a bare hash says a schema changed but not which export to go and look
 * at. Keys are the export names; kept beside the table above so the two cannot
 * disagree about what `forecastBatchSchema` is.
 */
export const PROMPT_SCHEMA_NAMES: Partial<Record<PromptName, string>> = {
    'express-prediction': 'expressPredictionSchema',
    'extract-prediction': 'predictionSchema',
    'suggest-tags': 'suggestTagsSchema',
    'bot-forecast-generation': 'forecastBatchSchema',
    'bot-sourceless-forecast-generation': 'forecastBatchSchema',
    'bot-vote-decision': 'voteDecisionSchema',
    'bot-config-generation': 'botConfigGenerationSchema',
    'research-query-generation': 'queryGenerationSchema',
    'resolution-research': 'researchSchema',
    'guess-chances': 'guessChancesSchema',
    'content-moderation': 'moderationSchema',
    'temporal-classifier': 'temporalClassifierSchema',
    'relation-typer': 'relationTyperSchema',
    'backfill-rules': 'rulesSchema',
}

export interface PromptFingerprint {
    hash: string
    chars: number
    schema: string | null
    schema_hash: string | null
    schema_chars: number | null
}

/**
 * Fingerprint both halves of one prompt. The lock test and the regeneration
 * script both call this, so a lock can never be written by different arithmetic
 * than the one that checks it.
 *
 * Prose is hashed unsubstituted — `{{appName}}` still a placeholder — so the
 * lock describes the prompt as authored rather than as rendered for one brand,
 * and a self-hosted instance's lock matches the SaaS one.
 *
 * The schema is hashed as `JSON.stringify` emits it, which is the serialisation
 * the provider sends. Key order is therefore part of the hash: reordering a
 * schema's properties reorders the fields the model generates, so it is a real
 * change and should read as one.
 *
 * 16 hex chars, matching retro's lock — enough to be unguessable in a diff, short
 * enough to eyeball.
 */
export function fingerprint(name: PromptName): PromptFingerprint {
    const prose = PROMPTS[name]
    const schema = PROMPT_SCHEMAS[name]
    const serialised = schema === null ? null : JSON.stringify(schema)
    return {
        hash: sha(prose),
        chars: prose.length,
        schema: PROMPT_SCHEMA_NAMES[name] ?? null,
        schema_hash: serialised === null ? null : sha(serialised),
        schema_chars: serialised === null ? null : serialised.length,
    }
}

function sha(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}
