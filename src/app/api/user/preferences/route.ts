import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { parseJsonBody } from '@/lib/api-body'
import { userPreferencesSchema } from '@/lib/validations/api-inputs'

const PREFERENCES_SELECT = { showAiPanel: true, feedTags: true } as const

/** GET /api/user/preferences — the current user's display preferences. */
export const GET = withAuth(async (_request, user) => {
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: PREFERENCES_SELECT,
    })
    return NextResponse.json({
      showAiPanel: row?.showAiPanel ?? false,
      feedTags: row?.feedTags ?? [],
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to load preferences')
  }
})

/** PATCH /api/user/preferences — update display preferences. Only whitelisted fields
 *  (the AI-panel flag, the remembered feed tag filter) are accepted, and only the ones
 *  sent are written; nothing here can change scoring, roles, or profile identity. */
export const PATCH = withAuth(async (request, user) => {
  try {
    const body = await parseJsonBody(request, userPreferencesSchema)

    const data: { showAiPanel?: boolean; feedTags?: string[] } = {}
    if (body.showAiPanel !== undefined) data.showAiPanel = body.showAiPanel
    if (body.feedTags !== undefined) data.feedTags = [...new Set(body.feedTags)]

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: PREFERENCES_SELECT,
    })
    return NextResponse.json(updated)
  } catch (error) {
    return handleRouteError(error, 'Failed to update preferences')
  }
})
