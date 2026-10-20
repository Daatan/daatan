import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getUnreadCount } from '@/lib/services/notification'
import { createLogger } from '@/lib/logger'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const log = createLogger('unread-count')


export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ count: 0 })
    }
    const rl = checkRateLimit(`unread-count:${session.user.id}`, 120, 60 * 1000)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)
    const count = await getUnreadCount(session.user.id)
    return NextResponse.json({ count })
  } catch (error) {
    log.error({ err: error }, 'Failed to fetch unread count')
    return NextResponse.json({ count: 0 })
  }
}
