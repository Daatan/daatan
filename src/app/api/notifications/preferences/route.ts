import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { getNotificationPreferences, upsertNotificationPreference } from '@/lib/services/notification'
import { parseJsonBody } from '@/lib/api-body'
import { notificationPreferenceSchema } from '@/lib/validations/api-inputs'


// GET /api/notifications/preferences — Return merged defaults + stored preferences
export const GET = withAuth(async (_request, user) => {
  try {
    const preferences = await getNotificationPreferences(user.id)
    return NextResponse.json({ preferences })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch notification preferences')
  }
})

// PATCH /api/notifications/preferences — Upsert a single type preference
export const PATCH = withAuth(async (request, user) => {
  try {
    const { type, inApp, email, browserPush } = await parseJsonBody(request, notificationPreferenceSchema)

    const preference = await upsertNotificationPreference(user.id, type, { inApp, email, browserPush })
    return NextResponse.json(preference)
  } catch (error) {
    return handleRouteError(error, 'Failed to update notification preference')
  }
})
