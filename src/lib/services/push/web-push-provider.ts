import webpush from 'web-push'
import { createLogger } from '@/lib/logger'
import { getAppUrl } from '@/lib/branding'
import { isSelfHosted } from '@/lib/edition'
import type { PushProvider, PushSendResult, PushTarget, PushMessage } from './types'

const log = createLogger('push-service')

function vapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey }
}

async function sendWithRetry(
  target: PushTarget,
  payload: string,
  attemptsLeft = 2,
): Promise<PushSendResult> {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
    )
    return 'sent'
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode === 410 || statusCode === 404) {
      return 'stale'
    } else if (statusCode === 401 || statusCode === 403) {
      // VAPID auth rejected: the subscription's public key doesn't match
      // VAPID_PRIVATE_KEY (e.g. a key rotation that updated one but not the other).
      // Retrying won't help — prune it so the client re-subscribes, and log loudly
      // since this silently breaks every send until someone notices.
      log.error(
        { endpoint: target.endpoint, statusCode },
        'Push rejected as unauthorized — VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY may not be a matching keypair',
      )
      return 'stale'
    } else if (attemptsLeft > 1) {
      await new Promise((r) => setTimeout(r, 500))
      return sendWithRetry(target, payload, attemptsLeft - 1)
    } else {
      log.error({ err: error, endpoint: target.endpoint }, 'Failed to send push notification after retries')
      return 'failed'
    }
  }
}

export const webPushProvider: PushProvider = {
  isConfigured() {
    return vapidKeys() !== null
  },

  async send(target: PushTarget, message: PushMessage): Promise<PushSendResult> {
    const keys = vapidKeys()
    if (!keys) {
      log.debug('Web push not configured (missing VAPID keys)')
      return 'failed'
    }

    const vapidContact = isSelfHosted()
      ? `mailto:push@${new URL(getAppUrl()).hostname}`
      : 'mailto:push@daatan.com'

    webpush.setVapidDetails(vapidContact, keys.publicKey, keys.privateKey)

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
      type: message.type,
    })

    return sendWithRetry(target, payload)
  },
}
