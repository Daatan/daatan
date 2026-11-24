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
    premature: {
      type: SchemaType.BOOLEAN,
      description:
        "True when the deadline has not passed yet and the claim is neither already confirmed nor already impossible — it is too early to resolve. outcome must then be 'unresolvable'.",
    },
    conditions: {
      type: SchemaType.ARRAY,
      description:
        "Each separate condition the resolution rules require (one entry for a single-condition claim). outcome may be 'correct' only when every status is 'met'.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          condition: { type: SchemaType.STRING, description: 'One condition, in your own words' },
          evidence: {
            type: SchemaType.STRING,
            description: 'The specific fact that decides it, with its source and date; empty when unconfirmed',
          },
          status: {
            type: SchemaType.STRING,
            format: 'enum',
            enum: ['met', 'failed', 'unconfirmed'],
            description: "'met' only when a source states it (a count or threshold needs the number)",
          },
        },
        required: ['condition', 'status'],
      },
    },
  },
  required: ['outcome', 'reasoning', 'evidenceLinks', 'conditions'],
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

// ============================================
// RULES-DIRECTION CHECK SCHEMA
// ============================================

/**
 * Paired with the `rules-strength` prompt (#1803): can the rules resolve YES on an
 * event easier to meet than the claim's own? `yesTrigger` comes first so the model
 * names the weakest YES event before it judges it.
 */
export const rulesStrengthSchema: Schema = {
  description: 'Whether the resolution rules resolve YES on an easier event than the claim states',
  type: SchemaType.OBJECT,
  properties: {
    yesTrigger: {
      type: SchemaType.STRING,
      description: 'The weakest event that makes the rules resolve YES, in one short sentence.',
    },
    weaker: {
      type: SchemaType.BOOLEAN,
      description: 'True when that trigger is easier to meet than the event the claim states.',
    },
    kind: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['none', 'announcement', 'intent', 'partial', 'scope', 'or_weak', 'other'],
      description: 'Which kind of weakening, or none when weaker is false.',
    },
    fixedRules: {
      type: SchemaType.STRING,
      description: 'Only when weaker: the rules rewritten to resolve YES only on the claim\'s own event, everything else kept. Otherwise an empty string.',
    },
  },
  required: ['yesTrigger', 'weaker', 'kind', 'fixedRules'],
}

/**
 * Paired with the `rules-direction` prompt (#1813): does YES under the resolution
 * rules mean the claim is true? `yesCondition` comes first so the model states the
 * rules' YES event before it judges it.
 */
export const rulesDirectionSchema: Schema = {
  description: 'Whether the resolution rules resolve YES when the claim is true',
  type: SchemaType.OBJECT,
  properties: {
    yesCondition: {
      type: SchemaType.STRING,
      description: 'The event that makes the rules resolve YES, in one short sentence.',
    },
    direction: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['consistent', 'inverted', 'unclear'],
      description: 'consistent: rules YES means the claim is true. inverted: rules YES means the claim is false. unclear: the rules never say what resolves YES.',
    },
    fixedRules: {
      type: SchemaType.STRING,
      description: 'Only when inverted: the rules rewritten so YES means the claim is true, everything else kept. Otherwise an empty string.',
    },
  },
  required: ['yesCondition', 'direction', 'fixedRules'],
}

export const claimDefinednessSchema: Schema = {
  description: 'Whether the claim has a deciding term with two common readings, or rules that conflict with it',
  type: SchemaType.OBJECT,
  properties: {
    splitOutcome: {
      type: SchemaType.STRING,
      description: 'An ordinary outcome on which the two readings settle differently, or the conflict in one sentence. Empty string when there is no fault.',
    },
    splitChance: {
      type: SchemaType.INTEGER,
      description: '0-100: how likely the split outcome is to happen. 0 when there is no fault.',
    },
    readerShare: {
      type: SchemaType.INTEGER,
      description: '0-100: share of ordinary readers who would take the reading the rules do not use (100 for a literal rules conflict). 0 when there is no fault.',
    },
    fault: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['none', 'two_readings', 'rules_conflict'],
      description: 'two_readings, rules_conflict, or none.',
    },
    term: {
      type: SchemaType.STRING,
      description: 'The deciding word or phrase, quoted from the claim (or the conflicting part of the rules). Empty when fault is none.',
    },
    question: {
      type: SchemaType.STRING,
      description: 'One short question asking the author which they mean. Empty when fault is none.',
    },
    options: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Two or three corrected one-sentence versions of the claim, each fixing one reading. Empty when fault is none.',
    },
  },
  required: ['splitOutcome', 'splitChance', 'readerShare', 'fault', 'term', 'question', 'options'],
}

/** daatan#2217: whether a cluster of pool reports is one past event, and the forecast it settles. */
export const retroEventJudgeSchema: Schema = {
  description: 'Whether grouped news reports describe one discrete past event, and the forecast question it settles',
  type: SchemaType.OBJECT,
  properties: {
    kind: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['event', 'routine', 'trend', 'not_yet', 'mixed', 'other'],
      description: 'event, routine, trend, not_yet, mixed, or other.',
    },
    reason: {
      type: SchemaType.STRING,
      description: 'One short sentence on why this kind.',
    },
    eventSummary: {
      type: SchemaType.STRING,
      description: 'One past-tense sentence: who did what. Empty unless kind is event.',
    },
    eventDate: {
      type: SchemaType.STRING,
      description: 'The day the event happened, YYYY-MM-DD. Empty when it cannot be told, or unless kind is event.',
    },
    eventIndex: {
      type: SchemaType.INTEGER,
      description: 'Number of the report that most directly confirms the event happened; 0 unless kind is event.',
    },
    claim: {
      type: SchemaType.STRING,
      description: 'Future-tense declarative forecast the event makes true, ending with "by {DEADLINE}". Empty unless kind is event.',
    },
    resolutionRules: {
      type: SchemaType.STRING,
      description: 'Two or three sentences: what counts as YES by {DEADLINE}, and NO otherwise. Empty unless kind is event.',
    },
  },
  required: ['kind', 'reason', 'eventSummary', 'eventDate', 'eventIndex', 'claim', 'resolutionRules'],
}

/** daatan#2229: per-article verdicts on a retro event's pre-T0 evidence, and the forecast it duplicates. */
export const retroEventCheckSchema: Schema = {
  description: "Per-article verdicts on a retro simulation's evidence, and whether an existing forecast already covers the event",
  type: SchemaType.OBJECT,
  properties: {
    articles: {
      type: SchemaType.ARRAY,
      description: 'One entry per article, in the order given.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          n: { type: SchemaType.INTEGER, description: 'The article number.' },
          onTopic: { type: SchemaType.BOOLEAN, description: "About the matter the question's outcome turns on." },
          reportsEvent: { type: SchemaType.BOOLEAN, description: 'Already says that what the question asks about has happened.' },
        },
        required: ['n', 'onTopic', 'reportsEvent'],
      },
    },
    sameEventAs: {
      type: SchemaType.INTEGER,
      description: 'Number of the existing forecast this event settles; 0 for none.',
    },
    reason: {
      type: SchemaType.STRING,
      description: 'One short sentence on the most important thing found.',
    },
  },
  required: ['articles', 'sameEventAs', 'reason'],
}

/**
 * Forward questions on this week's stories (daatan#2308): the topic run's clusters folded
 * into stories, each with 0–3 open questions or a pointer to the forecast that already asks one.
 */
export const topicSuggestSchema: Schema = {
  description: "This week's stories from clustered news reports, with the open forecast questions each one raises",
  type: SchemaType.OBJECT,
  properties: {
    stories: {
      type: SchemaType.ARRAY,
      description: 'One entry per story.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING, description: 'A short name for the story, a few words.' },
          groups: {
            type: SchemaType.ARRAY,
            description: 'The numbers of the report groups that belong to this story.',
            items: { type: SchemaType.INTEGER },
          },
          questions: {
            type: SchemaType.ARRAY,
            description: 'Zero to three open questions about what happens next in this story.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                claim: { type: SchemaType.STRING, description: 'Future-tense declarative forecast ending with "by {DEADLINE}". Empty when coveredBy is set.' },
                deadline: { type: SchemaType.STRING, description: 'YYYY-MM-DD by which the outcome will be known. Empty when coveredBy is set.' },
                resolutionRules: { type: SchemaType.STRING, description: 'Two or three sentences on what counts as YES by {DEADLINE}. Empty when coveredBy is set.' },
                coveredBy: { type: SchemaType.INTEGER, description: 'Number of the open forecast that already asks this question; 0 for none.' },
                reason: { type: SchemaType.STRING, description: 'One short sentence on why this is open and worth asking.' },
              },
              required: ['claim', 'deadline', 'resolutionRules', 'coveredBy', 'reason'],
            },
          },
        },
        required: ['title', 'groups', 'questions'],
      },
    },
  },
  required: ['stories'],
}
