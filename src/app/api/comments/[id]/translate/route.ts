import { NextRequest, NextResponse } from 'next/server'
import { apiError, handleRouteError } from '@/lib/api-error'
import { translateComment } from '@/lib/services/translation'
import { parseJsonBody } from '@/lib/api-body'
import { translateBodySchema } from '@/lib/validations/api-inputs'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'


// POST /api/comments/[id]/translate
// Body: { language: string }
// Returns translated comment text
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { language } = await parseJsonBody(request, translateBodySchema)

    // Public route calling an LLM on cache-miss — gate to prevent cost/DoS abuse.
    const rl = checkRateLimit(`comment-translate:${clientIp(request)}`, 30, 60 * 60_000)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)

    const translatedText = await translateComment(id, language)
    return NextResponse.json({ translatedText })
  } catch (err) {
    return handleRouteError(err, 'translate comment')
  }
}
