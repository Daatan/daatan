import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ForecastAttemptOutcome } from '@prisma/client'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled } from '@/lib/capabilities'
import { checkClaimDefinedness } from '@/lib/llm/claimDefinedness'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const log = createLogger('express-definedness')

const bodySchema = z.object({
  userInput: z.string().max(1000),
  claimText: z.string().min(5).max(500),
  resolutionRules: z.string().max(5000),
  // 'recheck' runs the judge on the author's edited claim; 'override' records that the
  // author published over a verdict that stayed unclear after its one re-check.
  kind: z.enum(['recheck', 'override']),
  term: z.string().max(200).optional(),
})

/**
 * daatan#2166: the review screen's escape hatch. A draft the judge called unclear can be
 * edited by hand; the edit is re-checked once here. Every call is logged on
 * `forecast_creation_attempts` (outcome DEFINEDNESS_CHECK).
 */
export const POST = withAuth(async (request, user) => {
  if (!aiFeaturesEnabled()) return apiError('AI features are not enabled on this instance', 404)
  const rl = checkRateLimit(`express-definedness:${user.id}`, 20, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const { userInput, claimText, resolutionRules, kind, term } = bodySchema.parse(await request.json())
  const definedness = kind === 'recheck'
    ? await checkClaimDefinedness(claimText, resolutionRules, userInput || claimText)
    : null

  prisma.forecastCreationAttempt
    .create({
      data: {
        userId: user.id,
        userInput: userInput.slice(0, 1000),
        outcome: ForecastAttemptOutcome.DEFINEDNESS_CHECK,
        details: { kind, claimText, ...(definedness ? { definedness } : { term: term ?? '' }) },
      },
    })
    .catch((err) => log.warn({ err, kind }, 'Failed to persist definedness check'))

  return NextResponse.json({ definedness })
})
