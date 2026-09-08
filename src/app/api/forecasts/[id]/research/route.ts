import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getForecastForResearch } from '@/lib/services/forecast'
import { runResolutionResearch } from '@/lib/services/resolutionResearch'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiResearchEnabled } from '@/lib/capabilities'

const RESEARCH_LIMIT = 10
const RESEARCH_WINDOW = 60 * 60_000 // 1 hour

export const POST = withAuth(async (request: NextRequest, user, { params }) => {
    if (!aiResearchEnabled()) {
        return apiError('AI features are not enabled on this instance', 404)
    }

    const rl = checkRateLimit(`research:${user.id}`, RESEARCH_LIMIT, RESEARCH_WINDOW)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)
    try {
        const prediction = await getForecastForResearch(params.id)

        if (!prediction) return apiError('Prediction not found', 404)

        const findings = await runResolutionResearch(prediction, { userId: user.id, source: 'research' })
        return NextResponse.json(findings)
    } catch (err) {
        return handleRouteError(err, 'Failed to perform AI research')
    }
}, { roles: ['RESOLVER', 'ADMIN'] })
