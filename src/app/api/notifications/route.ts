import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { listNotifications, markAllNotificationsRead } from '@/lib/services/notification'


// GET /api/notifications - List notifications for current user
export const GET = withAuth(async (request, user) => {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const unreadOnly = searchParams.get('unreadOnly') === 'true'

  const result = await listNotifications(user.id, { page, limit, unreadOnly })
  return NextResponse.json(result)
})

// POST /api/notifications - Mark all as read
export const POST = withAuth(async (_request, user) => {
  await markAllNotificationsRead(user.id)
  return NextResponse.json({ success: true })
})
