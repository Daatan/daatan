import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/user/preferences — the current user's chart/display preferences. */
export const GET = withAuth(async (_request, user) => {
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { showAiPanel: true },
    })
    return NextResponse.json({ showAiPanel: row?.showAiPanel ?? false })
  } catch (error) {
    return handleRouteError(error, 'Failed to load preferences')
  }
})

/** PATCH /api/user/preferences — update a display preference. Only whitelisted boolean
 *  flags are accepted; nothing here can change scoring, roles, or profile identity. */
export const PATCH = withAuth(async (request, user) => {
  try {
    const body = (await request.json()) as { showAiPanel?: unknown }

    if (typeof body.showAiPanel !== 'boolean') {
      return NextResponse.json({ error: 'showAiPanel must be a boolean' }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { showAiPanel: body.showAiPanel },
      select: { showAiPanel: true },
    })
    return NextResponse.json(updated)
  } catch (error) {
    return handleRouteError(error, 'Failed to update preferences')
  }
})
