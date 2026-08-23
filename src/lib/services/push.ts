import webpush from 'web-push'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { getAppUrl } from '@/lib/branding'
import { isSelfHosted } from '@/lib/edition'

const log = createLogger('push-service')

/**
 * Dispatch a browser push notification to all of a user's subscribed devices.
 * Fire-and-forget: never throws, logs errors. Mirrors telegram.ts pattern.
 */
export async function dispatchBrowserPush(
  userId: string,
  notification: { title: string; message: string; link?: string; type: string },
): Promise<void> {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY

  if (!vapidPublicKey || !vapidPrivateKey) {
    log.debug('Web push not configured (missing VAPID keys)')
    return
  }

  const vapidContact = isSelfHosted()
    ? `mailto:push@${new URL(getAppUrl()).hostname}`
    : 'mailto:push@daatan.com'

  webpush.setVapidDetails(
    vapidContact,
    vapidPublicKey,
    vapidPrivateKey,
  )

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  })

  if (subscriptions.length === 0) return

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.message,
    url: notification.link || '/',
    type: notification.type,
  })

  const successIds: string[] = []
  const staleIds: string[] = []

  const sendWithRetry = async (sub: typeof subscriptions[number], attemptsLeft = 2): Promise<void> => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
      successIds.push(sub.id)
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 410 || statusCode === 404) {
        staleIds.push(sub.id)
      } else if (statusCode === 401 || statusCode === 403) {
        // VAPID auth rejected: the subscription's public key doesn't match
        // VAPID_PRIVATE_KEY (e.g. a key rotation that updated one but not the other).
        // Retrying won't help — prune it so the client re-subscribes, and log loudly
        // since this silently breaks every send until someone notices.
        staleIds.push(sub.id)
        log.error(
          { endpoint: sub.endpoint, statusCode },
          'Push rejected as unauthorized — VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY may not be a matching keypair',
        )
      } else if (attemptsLeft > 1) {
        await new Promise((r) => setTimeout(r, 500))
        return sendWithRetry(sub, attemptsLeft - 1)
      } else {
        log.error({ err: error, endpoint: sub.endpoint }, 'Failed to send push notification after retries')
      }
    }
  }

  await Promise.allSettled(subscriptions.map((sub) => sendWithRetry(sub)))

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
