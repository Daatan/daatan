import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { z } from 'zod'
import { getProviderForUrl, resolveMarketByUrl } from '@/lib/services/external-markets'
import { createLogger } from '@/lib/logger'

const log = createLogger('forecasts-import-market')

export const dynamic = 'force-dynamic'

const importSchema = z.object({ url: z.string().min(1) })

const PROVIDER_LABEL: Record<string, string> = {
  POLYMARKET: 'Polymarket',
  KALSHI: 'Kalshi',
}

/**
 * POST /api/forecasts/import-market  body: { url }
 *
 * Resolve a pasted prediction-market URL (Polymarket / Kalshi) into a forecast
 * prefill: the market question becomes the claim, the market end date becomes
 * the resolve-by date. Caches the market and returns its id so the create flow
 * can link it. Any signed-in user (the create wizard calls this).
 */
export const POST = withAuth(async (request) => {
  const { url } = importSchema.parse(await request.json())

  const provider = getProviderForUrl(url)
  if (!provider) {
    return apiError('That URL is not a supported prediction market (Polymarket / Kalshi)', 422)
  }

  const market = await resolveMarketByUrl(url)
  if (!market) {
    return apiError('Could not load that market — check the URL and try again', 422)
  }

  log.info({ marketId: market.id, provider: market.provider }, 'Imported market for forecast prefill')

  return NextResponse.json({
    externalMarketId: market.id,
    provider: market.provider,
    providerLabel: PROVIDER_LABEL[market.provider] ?? market.provider,
    claimText: market.question,
    // endDate → resolve-by; client localizes. Null when the market has no end date.
    resolveByDatetime: market.endDate ? market.endDate.toISOString() : null,
    url: market.url,
  })
})
