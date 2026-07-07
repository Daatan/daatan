import { generateExpressPrediction, NoArticlesFoundError, extractFirstUrl } from '@/lib/llm/expressPrediction'
import { z } from 'zod'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled, aiResearchEnabled } from '@/lib/capabilities'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { ForecastAttemptOutcome, Prisma } from '@prisma/client'

const log = createLogger('express-generate')

/**
 * Persist a forecast-creation attempt audit row. Fire-and-forget — a DB
 * failure here must not break the user's response stream.
 */
function recordAttempt(
  userId: string,
  userInput: string,
  isUrl: boolean,
  outcome: ForecastAttemptOutcome,
  details: Prisma.InputJsonValue | null = null,
): void {
  prisma.forecastCreationAttempt
    .create({
      data: {
        userId,
        userInput: userInput.slice(0, 1000),
        isUrl,
        outcome,
        details: details ?? undefined,
      },
    })
    .catch((err) => log.warn({ err, outcome }, 'Failed to persist forecast attempt'))
}

const generateSchema = z.object({
  userInput: z.string().min(5).max(1000),
  skipSources: z.boolean().optional().default(false),
})

export const POST = withAuth(async (request, user) => {
  if (!aiFeaturesEnabled()) {
    return apiError('AI features are not enabled on this instance', 404)
  }

  const body = await request.json()
  const { userInput, skipSources } = generateSchema.parse(body)
  // Records whether the input carried a source link (anywhere, not only as a bare
  // URL) — matches how generateExpressPrediction now anchors on a pasted link.
  const isUrl = extractFirstUrl(userInput) !== null

  // Without a search backend (the LLM-only self-host case) skip the article
  // search and generate from the user's text alone. The LLM provider itself
  // (OpenRouter / Gemini / Ollama) is resolved inside llmService.
  const effectiveSkipSources = skipSources || !aiResearchEnabled()


  // Create a readable stream for progress updates
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Progress callback
        const onProgress = (stage: string, data?: Record<string, unknown>) => {
          const message = JSON.stringify({ stage, data }) + '\n'
          controller.enqueue(encoder.encode(message))
        }

        // Generate prediction with progress updates
        const result = await generateExpressPrediction(userInput, onProgress, effectiveSkipSources, { source: 'express-creation', userId: user.id })

        // Send final result
        const finalMessage = JSON.stringify({ stage: 'complete', data: result }) + '\n'
        controller.enqueue(encoder.encode(finalMessage))
        recordAttempt(user.id, userInput, isUrl, ForecastAttemptOutcome.SUCCESS, { skipSources })
        controller.close()
      } catch (error) {
        if (error instanceof NoArticlesFoundError) {
          log.warn(
            {
              userInput: error.details.searchedFor,
              isUrl: error.details.isUrl,
              isNonLatin: error.details.isNonLatin,
            },
            'Express forecast: no articles found',
          )
          recordAttempt(user.id, userInput, isUrl, ForecastAttemptOutcome.NO_ARTICLES, {
            searchedFor: error.details.searchedFor,
            isNonLatin: error.details.isNonLatin,
          })
          const errorMessage = JSON.stringify({
            stage: 'error',
            error: 'NO_ARTICLES_FOUND',
            message: "Couldn't find relevant articles. Try rephrasing your prediction or being more specific.",
            details: error.details,
          }) + '\n'
          controller.enqueue(encoder.encode(errorMessage))
        } else if (error instanceof Error && error.message.startsWith('OFFENSIVE_INPUT:')) {
          const reason = error.message.split('OFFENSIVE_INPUT:')[1].trim()
          recordAttempt(user.id, userInput, isUrl, ForecastAttemptOutcome.MODERATED, { moderationReason: reason })
          const errorMessage = JSON.stringify({
            stage: 'error',
            error: 'OFFENSIVE_INPUT',
            message: `Moderation: ${reason}`
          }) + '\n'
          controller.enqueue(encoder.encode(errorMessage))
        } else if (error instanceof Error && /Search API error: (400|401|403|429)/.test(error.message)) {
          const match = error.message.match(/Search API error: (\d+)/)
          recordAttempt(user.id, userInput, isUrl, ForecastAttemptOutcome.SEARCH_UNAVAILABLE, {
            searchErrorCode: match ? Number(match[1]) : null,
          })
          const errorMessage = JSON.stringify({
            stage: 'error',
            error: 'SEARCH_UNAVAILABLE',
            message: 'Search service is temporarily unavailable. Please try again later or create a forecast manually.'
          }) + '\n'
          controller.enqueue(encoder.encode(errorMessage))
        } else {
          const errMsg = error instanceof Error ? error.message : String(error)
          recordAttempt(user.id, userInput, isUrl, ForecastAttemptOutcome.GENERATION_FAILED, {
            errorMessage: errMsg.slice(0, 500),
          })
          const errorMessage = JSON.stringify({
            stage: 'error',
            error: 'GENERATION_FAILED',
            message: error instanceof Error ? `Failed: ${error.message}` : 'Failed to generate prediction'
          }) + '\n'
          controller.enqueue(encoder.encode(errorMessage))
        }
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})
