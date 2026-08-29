import { Schema, SchemaType } from '@google/generative-ai'

// ============================================
// BOT RUNNER SCHEMAS
// ============================================

/**
 * Structured output schema for bot forecast generation.
 * Used in bot-runner.ts processTopic() and admin/bots/route.ts (dry-run preview).
 */
export const forecastBatchSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    claimText: { type: SchemaType.STRING },
    detailsText: { type: SchemaType.STRING },
    outcomeType: { type: SchemaType.STRING },
    resolveByDatetime: { type: SchemaType.STRING },
    resolutionRules: { type: SchemaType.STRING },
    tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    skip: {
      type: SchemaType.BOOLEAN,
      description: 'Set to true if the topic does not match the required tags',
    },
  },
  required: ['claimText', 'outcomeType', 'resolveByDatetime', 'resolutionRules'],
}

/**
 * Structured output schema for bot vote decisions.
 * Used in bot-runner.ts runVoting().
 */
export const voteDecisionSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    shouldVote: { type: SchemaType.BOOLEAN },
    binaryChoice: { type: SchemaType.BOOLEAN },
    reason: { type: SchemaType.STRING },
  },
  required: ['shouldVote', 'binaryChoice'],
}

// ============================================
// RESEARCH / RESOLUTION SCHEMAS
// ============================================

/**
 * Structured output schema for generating web search queries.
 * Used in forecasts/[id]/research/route.ts.
 */
export const queryGenerationSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    queries: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        '2-3 short, factual web search queries (3-7 words each) to find news about the forecast outcome',
    },
  },
  required: ['queries'],
}

/**
 * Structured output schema for forecast resolution research.
 * Used in forecasts/[id]/research/route.ts.
 */
export const researchSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    outcome: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['correct', 'wrong', 'void', 'unresolvable'],
      description: 'The suggested resolution outcome',
    },
    correctOptionId: {
      type: SchemaType.STRING,
      description:
        "The ID of the correct option if the prediction is MULTIPLE_CHOICE and outcome is 'correct'",
    },
    reasoning: {
      type: SchemaType.STRING,
      description: 'Brief explanation of why this outcome was chosen based on the evidence',
    },
    evidenceLinks: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'List of URLs found that support the resolution',
    },
  },
  required: ['outcome', 'reasoning', 'evidenceLinks'],
}

// ============================================
// BOT CONFIG GENERATION SCHEMA
// ============================================

/**
 * Structured output schema for LLM-generated bot configuration.
 * Used in admin/bots/route.ts when auto-generating prompts from a bot name.
 */
export const botConfigGenerationSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    personaPrompt: { type: SchemaType.STRING },
    forecastPrompt: { type: SchemaType.STRING },
    votePrompt: { type: SchemaType.STRING },
    newsSources: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ['personaPrompt', 'forecastPrompt', 'votePrompt', 'newsSources'],
}

// ============================================
// RESOLUTION-RULES BACKFILL SCHEMA
// ============================================

/**
 * Structured output schema for backfilling resolution rules.
 * Used in admin/forecasts/backfill-rules/route.ts, paired with the
 * `backfill-rules` prompt. Lived in the route until #1658 — its `description`
 * fields are model-facing prompt text, and the lock has to be able to see them.
 */
export const rulesSchema: Schema = {
  description: 'Resolution rules for a prediction',
  type: SchemaType.OBJECT,
  properties: {
    resolutionRules: {
      type: SchemaType.STRING,
      description: 'Clear, specific criteria for how this prediction resolves. 1-3 sentences.',
    },
  },
  required: ['resolutionRules'],
}
