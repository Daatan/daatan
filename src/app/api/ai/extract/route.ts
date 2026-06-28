import { NextResponse } from 'next/server'
import { fetchUrlContent } from '@/lib/utils/scraper'
import { extractPrediction } from '@/lib/llm/gemini'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled } from '@/lib/capabilities'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (req) => {
  if (!aiFeaturesEnabled()) {
    return apiError('AI features are not enabled on this instance', 404)
  }

  const { url, text } = await req.json()

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
