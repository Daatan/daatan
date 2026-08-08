import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { z } from 'zod'
import { suggestMarketMatch } from '@/lib/services/external-markets'
import { externalMarketsEnabled } from '@/lib/capabilities'
import { createLogger } from '@/lib/logger'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const log = createLogger('forecasts-suggest-market')

export const dynamic = 'force-dynamic'

const suggestSchema = z.object({
  claimText: z.string().min(1),
  // Optional — the wizard only knows the deadline once the user has filled the
  // date step. When present it penalizes candidates resolving far from it.
  deadline: z.string().datetime().optional(),
})

/**
 * POST /api/forecasts/suggest-market  body: { claimText, deadline? }
 *
 * Called from the create wizard after the claim step. Keyword-prefilters
 * candidate markets, embeds the claim + candidates, and returns the single
 * best match when it's "very similar / the same question" (cosine ≥ threshold),
 * so the wizard can offer to link it. Returns `{ match: null }` otherwise.
 * Best-effort — never throws on the matching path. Any signed-in user.
 */
export const POST = withAuth(async (request, user) => {
  if (!externalMarketsEnabled()) {
    return NextResponse.json({ match: null })
  }

  // Embeds the claim plus every keyword-filtered candidate market (uncapped) —
  // throttle per user like the app's other AI-cost routes.
  const rl = checkRateLimit(`suggest-market:${user.id}`, 20, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const { claimText, deadline } = suggestSchema.parse(await request.json())

  const match = await suggestMarketMatch(claimText, deadline ? new Date(deadline) : null)
  if (match) {
    log.info({ marketId: match.externalMarketId, score: match.score }, 'Market match suggested')
  }

  return NextResponse.json({ match })
})
