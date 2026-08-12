import { withAuth } from '@/lib/api-middleware'
import { llmService } from '@/lib/llm'
import { SchemaType } from '@google/generative-ai'
import type { Schema } from '@google/generative-ai'
import { findPredictionsWithoutRules, updateForecastResolutionRules } from '@/lib/services/forecast'

export const maxDuration = 300

const rulesSchema: Schema = {
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

async function generateRules(claimText: string, detailsText: string | null, outcomeType: string): Promise<string> {
  const response = await llmService.generateContent({
    prompt: `Generate clear resolution rules for this prediction forecast.

Prediction: "${claimText}"
${detailsText ? `Details: "${detailsText}"` : ''}
Type: ${outcomeType === 'BINARY' ? 'Yes/No (BINARY)' : 'Multiple choice (MULTIPLE_CHOICE)'}

Write 1-3 sentences specifying exactly what evidence or conditions would cause this prediction to resolve YES (or for the correct option) vs NO. Be specific and objective. Focus on verifiable facts.`,
    schema: rulesSchema,
    temperature: 0,
  })

  const parsed = JSON.parse(response.text) as { resolutionRules: string }
  return parsed.resolutionRules
}

export const POST = withAuth(async (_req) => {
  const predictions = await findPredictionsWithoutRules()

  if (predictions.length === 0) {
    return Response.json({ updated: 0, message: 'No predictions need backfilling' })
  }

  let updated = 0
  let failed = 0
  const errors: string[] = []

  for (const prediction of predictions) {
    try {
      const rules = await generateRules(prediction.claimText, prediction.detailsText, prediction.outcomeType)
      await updateForecastResolutionRules(prediction.id, rules)
      updated++
    } catch (err) {
      failed++
      errors.push(`${prediction.id}: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  return Response.json({ updated, failed, total: predictions.length, errors: errors.slice(0, 10) })
}, { roles: ['ADMIN'] })
