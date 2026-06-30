import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { getBotById, listBotLogs } from '@/lib/services/bot'

export const dynamic = 'force-dynamic'

// GET /api/admin/bots/[id]/logs?page=1&limit=20 — paginated run log
export const GET = withAuth(
  async (request: NextRequest, _user, { params }) => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked
    try {
      const bot = await getBotById(params.id)
      if (!bot) return apiError('Bot not found', 404)

      const { searchParams } = new URL(request.url)
      const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
      const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))

      const { logs, total } = await listBotLogs(params.id, page, limit)

      return NextResponse.json({
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    } catch (err) {
      return handleRouteError(err, 'Failed to fetch bot logs')
    }
  },
  { roles: ['ADMIN'] },
)
