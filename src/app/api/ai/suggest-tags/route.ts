import { NextResponse } from 'next/server'
import { suggestTags } from '@/lib/llm/gemini'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled } from '@/lib/capabilities'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseJsonBody } from '@/lib/api-body'
import { suggestTagsBodySchema } from '@/lib/validations/api-inputs'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (req, user) => {
    if (!aiFeaturesEnabled()) {
        return apiError('AI features are not enabled on this instance', 404)
    }

    const rl = checkRateLimit(`suggest-tags:${user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)

    const { claim, details } = await parseJsonBody(req, suggestTagsBodySchema)

    try {
        const tags = await suggestTags(claim, details)
        return NextResponse.json({ tags })
    } catch (error) {
        return apiError('Failed to suggest tags', 500)
    }
})
