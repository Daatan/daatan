import { SchemaType, type Schema } from '@google/generative-ai'
import { getPromptTemplate, fillPrompt } from './bedrock-prompts'
import { llmService } from './index'
import { createLogger } from '@/lib/logger'
import { STANDARD_TAGS } from '@/lib/constants'

const log = createLogger('llm-gemini')


export const suggestTagsSchema: Schema = {
  description: "Suggested tags for a prediction",
  type: SchemaType.OBJECT,
  properties: {
    tags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of 1-3 relevant tags",
    }
  },
  required: ["tags"],
}

export const predictionSchema: Schema = {
  description: "Structured prediction data extracted from text or URL",
  type: SchemaType.OBJECT,
  properties: {
    claim: {
      type: SchemaType.STRING,
      description: "The core prediction or claim made by the person",
    },
    author: {
      type: SchemaType.STRING,
      description: "The name of the person who made the prediction",
    },
    sourceUrl: {
      type: SchemaType.STRING,
      description: "The source URL where the prediction was found",
    },
    resolutionDate: {
      type: SchemaType.STRING,
      description: "The date when the prediction can be verified (ISO 8601 format)",
    },
    outcomeOptions: {
      type: SchemaType.ARRAY,
      description: "The possible outcomes for the prediction (e.g., ['Yes', 'No'])",
      items: {
        type: SchemaType.STRING
      }
    }
  },
  required: ["claim", "author", "resolutionDate", "outcomeOptions"],
}

export async function suggestTags(claim: string, details?: string) {
  const template = await getPromptTemplate('suggest-tags')
  const prompt = fillPrompt(template, {
    claim,
    details: details ? `Details: "${details}"` : '',
    STANDARD_TAGS: STANDARD_TAGS.join(', '),
  })

  try {
    const result = await llmService.generateContent({
      prompt,
      schema: suggestTagsSchema,
      temperature: 0,
    })

    try {
      const parsed = JSON.parse(result.text)
      return (parsed.tags ?? []).filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
    } catch {
      log.error({ text: result.text }, 'Failed to parse tag suggestion response')
      return []
    }
  } catch (error) {
    log.error({ err: error }, 'Failed to suggest tags')
    return []
  }
}

export async function extractPrediction(text: string) {
  const template = await getPromptTemplate('extract-prediction')
  const prompt = fillPrompt(template, { text })

  try {
    const result = await llmService.generateContent({
      prompt,
      schema: predictionSchema,
      temperature: 0,
    })

    try {
      return JSON.parse(result.text)
    } catch {
      log.error({ text: result.text }, 'Failed to parse LLM response as JSON')
      throw new Error('LLM returned malformed JSON')
    }
  } catch (error) {
    log.error({ err: error }, 'Failed to extract prediction')
    throw error
  }
}
