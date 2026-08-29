import { withAuth } from '@/lib/api-middleware'
import { llmService } from '@/lib/llm'
import { fillPrompt, getPromptTemplate } from '@/lib/llm/bedrock-prompts'
import { rulesSchema } from '@/lib/llm/schemas'
import { findPredictionsWithoutRules, updateForecastResolutionRules } from '@/lib/services/forecast'

export const maxDuration = 300

async function generateRules(claimText: string, detailsText: string | null, outcomeType: string): Promise<string> {
  const template = await getPromptTemplate('backfill-rules')
  const response = await llmService.generateContent({
    prompt: fillPrompt(template, {
      claimText,
      detailsLine: detailsText ? `Details: "${detailsText}"` : '',
      typeLabel: outcomeType === 'BINARY' ? 'Yes/No (BINARY)' : 'Multiple choice (MULTIPLE_CHOICE)',
    }),
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
