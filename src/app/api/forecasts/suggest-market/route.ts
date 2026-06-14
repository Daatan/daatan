import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { z } from 'zod'
import { suggestMarketMatch } from '@/lib/services/external-markets'
import { createLogger } from '@/lib/logger'

const log = createLogger('forecasts-suggest-market')

export const dynamic = 'force-dynamic'

const suggestSchema = z.object({ claimText: z.string().min(1) })

/**
 * POST /api/forecasts/suggest-market  body: { claimText }
 *
 * Called from the create wizard after the claim step. Keyword-prefilters
 * candidate markets, embeds the claim + candidates, and returns the single
 * best match when it's "very similar / the same question" (cosine ≥ threshold),
 * so the wizard can offer to link it. Returns `{ match: null }` otherwise.
 * Best-effort — never throws on the matching path. Any signed-in user.
 */
export const POST = withAuth(async (request) => {
  const { claimText } = suggestSchema.parse(await request.json())

  const match = await suggestMarketMatch(claimText)
  if (match) {
    log.info({ marketId: match.externalMarketId, score: match.score }, 'Market match suggested')
  }

  return NextResponse.json({ match })
})
