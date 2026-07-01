import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchUrlContent } from '@/lib/utils/scraper'
import { extractPrediction } from '@/lib/llm/gemini'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled } from '@/lib/capabilities'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const extractSchema = z.object({
  url: z.string().url().optional(),
  text: z.string().max(50_000).optional(),
})

export const POST = withAuth(async (req) => {
  if (!aiFeaturesEnabled()) {
    return apiError('AI features are not enabled on this instance', 404)
  }

  const rl = checkRateLimit(`ai-extract:${clientIp(req)}`, 20, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const parsed = extractSchema.safeParse(await req.json())
  if (!parsed.success) {
    return apiError('Invalid request: url must be a valid URL and text under 50k chars', 400)
  }
  const { url, text } = parsed.data

  let contentToProcess = text

  if (url && !text) {
    contentToProcess = await fetchUrlContent(url)
  }

  if (!contentToProcess) {
    return apiError('No content provided', 400)
  }

  const result = await extractPrediction(contentToProcess)
  
  // If we fetched from a URL, ensure it's in the response
  if (url && !result.sourceUrl) {
    result.sourceUrl = url
  }

  return NextResponse.json(result)
})
