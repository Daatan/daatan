import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { runBotById } from '@/lib/services/bots'
import { getBotRunJob, startBotRunJob } from '@/lib/services/bots/runJobs'
import { apiError, handleRouteError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { getBotById } from '@/lib/services/bot'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

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
      // Runs can outlast nginx's proxy timeout, so start in the background and
      // let the client poll GET (#1947). A run already in flight is joined.
      const started = startBotRunJob(params.id, dryRun, () => runBotById(params.id, dryRun))

      return NextResponse.json({ ok: true, status: 'running', started }, { status: 202 })
    } catch (err) {
      return handleRouteError(err, 'Failed to run bot')
    }
  },
  { roles: ['ADMIN'] },
)

// GET /api/admin/bots/[id]/run — state of the latest manual run (poll target)
export const GET = withAuth(
  async (_request: NextRequest, _user, { params }) => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked

    const job = getBotRunJob(params.id)
    if (!job) return NextResponse.json({ ok: true, status: 'none' })
    return NextResponse.json({ ok: true, ...job })
  },
  { roles: ['ADMIN'] },
)
