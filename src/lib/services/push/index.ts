import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { webPushProvider } from './web-push-provider'
import type { PushProvider, PushTarget } from './types'

const log = createLogger('push-service')

const activeProvider: PushProvider = webPushProvider

/**
 * Dispatch a push notification to all of a user's subscribed devices.
 * Fire-and-forget: never throws, logs errors. Mirrors telegram.ts pattern.
 */
export async function dispatchBrowserPush(
  userId: string,
  notification: { title: string; message: string; link?: string; type: string },
): Promise<void> {
  if (!activeProvider.isConfigured()) return

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  })

  if (subscriptions.length === 0) return

  const message = {
    title: notification.title,
    body: notification.message,
    url: notification.link || '/',
    type: notification.type,
  }

  const successIds: string[] = []
  const staleIds: string[] = []

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const target: PushTarget = { id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }
      const result = await activeProvider.send(target, message)
      if (result === 'sent') successIds.push(sub.id)
      else if (result === 'stale') staleIds.push(sub.id)
    }),
  )

  // Batch DB operations rather than N individual queries
  const now = new Date()
  await Promise.allSettled([
    successIds.length > 0
      ? prisma.pushSubscription.updateMany({
          where: { id: { in: successIds } },
          data: { lastUsedAt: now },
        })
      : Promise.resolve(),
    staleIds.length > 0
      ? (log.info({ count: staleIds.length }, 'Removing stale push subscriptions'),
        prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } }))
      : Promise.resolve(),
  ])

  const failed = subscriptions.length - successIds.length - staleIds.length
  if (failed > 0) {
    log.warn({ userId, total: subscriptions.length, failed }, 'Some push notifications failed')
  }
}

export async function upsertPushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent?: string,
) {
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: { not: userId } },
  })

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh, auth, userAgent },
    update: { p256dh, auth, userAgent },
  })
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } })
}
