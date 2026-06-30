import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { runBotById } from '@/lib/services/bots'
import { apiError, handleRouteError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { getBotById } from '@/lib/services/bot'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BOT_RUN_LIMIT = 5
const BOT_RUN_WINDOW = 60 * 60_000 // 1 hour

// POST /api/admin/bots/[id]/run?dry=true — manual trigger (with optional dry run)
export const POST = withAuth(
  async (request: NextRequest, user, { params }) => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked
    const rl = checkRateLimit(`bot-run:${user.id}`, BOT_RUN_LIMIT, BOT_RUN_WINDOW)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)

    try {
      const bot = await getBotById(params.id)
      if (!bot) return apiError('Bot not found', 404)

      const dryRun = new URL(request.url).searchParams.get('dry') === 'true'
      const summary = await runBotById(params.id, dryRun)

      return NextResponse.json({ ok: true, summary })
    } catch (err) {
      return handleRouteError(err, 'Failed to run bot')
    }
  },
  { roles: ['ADMIN'] },
)
