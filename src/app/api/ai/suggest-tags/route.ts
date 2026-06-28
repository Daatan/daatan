import { NextResponse } from 'next/server'
import { suggestTags } from '@/lib/llm/gemini'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { aiFeaturesEnabled } from '@/lib/capabilities'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (req, user) => {
    if (!aiFeaturesEnabled()) {
        return apiError('AI features are not enabled on this instance', 404)
    }

    const rl = checkRateLimit(`suggest-tags:${user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)

    const { claim, details } = await req.json()

    if (!claim) {
        return apiError('Claim is required', 400)
    }

    try {
        const tags = await suggestTags(claim, details)
        return NextResponse.json({ tags })
    } catch (error) {
        return apiError('Failed to suggest tags', 500)
    }
})
