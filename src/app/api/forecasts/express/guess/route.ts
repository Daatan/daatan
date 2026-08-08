import { guessChances } from '@/lib/llm/expressPrediction'
import { getOracleProbability, INTERACTIVE_FORECAST_TIMEOUT_MS } from '@/lib/services/oracle'
import { z } from 'zod'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled } from '@/lib/capabilities'
import { createLogger } from '@/lib/logger'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'

const log = createLogger('express-guess')

const guessSchema = z.object({
  claimText: z.string().min(5),
  detailsText: z.string(),
  articles: z.array(z.object({
    title: z.string(),
    source: z.string(),
    snippet: z.string(),
  })),
})

export const POST = withAuth(async (request, user) => {
  if (!aiFeaturesEnabled()) {
    return apiError('AI features are not enabled on this instance', 404)
  }

  // Called from the interactive drafting flow, so it's legitimately hit more than
  // once per forecast — looser than express-generate but still throttled per user.
  const rl = checkRateLimit(`express-guess:${user.id}`, 30, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  try {
    const body = await request.json()
    const { claimText, detailsText, articles } = guessSchema.parse(body)

    const t0 = Date.now()
    // Interactive: a user is waiting on this while drafting a claim, and the LLM
    // fallback below is the better trade past ~12s. Opts out of the default (30s),
    // which is sized for the background push/sweep paths — see oracle.ts.
    const oracleProb = await getOracleProbability(
      claimText,
      { source: 'express-guess', userId: user.id },
      { timeoutMs: INTERACTIVE_FORECAST_TIMEOUT_MS },
    )
    log.info({ durationMs: Date.now() - t0, source: oracleProb !== null ? 'oracle' : 'llm' }, 'express-guess: probability')
    if (oracleProb !== null) {
      return NextResponse.json({
        probability: Math.round(oracleProb * 100),
        reasoning: 'TruthMachine Oracle (calibrated multi-source estimate)',
      })
    }

    const result = await guessChances(claimText, detailsText, articles)
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error, 'Failed to guess chances')
  }
})
