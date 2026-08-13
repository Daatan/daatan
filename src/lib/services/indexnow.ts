import { SignJWT, importPKCS8 } from 'jose'
import { env } from '@/env'
import { createLogger } from '@/lib/logger'
import { getAppUrl } from '@/lib/branding'

const log = createLogger('search-indexing')

function urlFor(slug: string): string {
  return `${getAppUrl()}/forecasts/${slug}`
}

/** IndexNow accepts at most 10,000 URLs per request. */
const INDEXNOW_BATCH = 10_000

/**
 * Submit a batch of already-built URLs to IndexNow in one or more requests
 * (Bing/Yandex/Seznam — not Google). Unlike the fire-and-forget per-event
 * `notifyIndexNow`, this awaits each request and reports counts, so an admin
 * backlog resubmission can surface the result. No-op (returns zeros) without
 * INDEXNOW_KEY or when given no URLs. The host + keyLocation are derived from
 * the first URL so it stays correct for any deployment.
 */
export async function notifyIndexNowBulk(urls: string[]): Promise<{ submitted: number; batches: number }> {
  const key = env.INDEXNOW_KEY
  if (!key || urls.length === 0) return { submitted: 0, batches: 0 }
  const host = new URL(urls[0]).hostname

  let submitted = 0
  let batches = 0
  for (let i = 0; i < urls.length; i += INDEXNOW_BATCH) {
    const urlList = urls.slice(i, i + INDEXNOW_BATCH)
    batches += 1
    try {
      const res = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
      })
      if (res.ok) {
        submitted += urlList.length
        log.info({ count: urlList.length, host }, 'IndexNow bulk ping sent')
      } else {
        log.warn({ status: res.status, count: urlList.length, host }, 'IndexNow bulk ping failed')
      }
    } catch (err) {
      log.warn({ err, count: urlList.length, host }, 'IndexNow bulk ping error')
    }
  }
  return { submitted, batches }
}

/** Ping IndexNow (Bing/Yandex/Seznam — not Google) for a forecast URL. No-op without INDEXNOW_KEY. */
export function notifyIndexNow(slug: string): void {
  const key = env.INDEXNOW_KEY
  if (!key) return
  const appUrl = getAppUrl()
  const host = new URL(appUrl).hostname
  const url = urlFor(slug)
  fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${appUrl}/${key}.txt`, urlList: [url] }),
  })
    .then((res) => {
      if (!res.ok) log.warn({ status: res.status, url }, 'IndexNow ping failed')
      else log.info({ url }, 'IndexNow ping sent')
    })
    .catch((err) => log.warn({ err, url }, 'IndexNow ping error'))
}

async function googleAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  // SA keys are PKCS8 PEM; env transport often escapes newlines as literal "\n".
  const key = await importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/indexing' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`token endpoint ${res.status}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('token endpoint returned no access_token')
  return json.access_token
}

/**
 * Ping the Google Indexing API for a forecast URL. No-op unless both service-account
 * env vars are set (the SA must be an owner of the property in Search Console).
 * Note: the Indexing API is officially scoped to JobPosting/BroadcastEvent content;
 * it is used here as a best-effort discovery nudge.
 */
export function notifyGoogle(slug: string): void {
  const clientEmail = env.GOOGLE_INDEXING_CLIENT_EMAIL
  const privateKey = env.GOOGLE_INDEXING_PRIVATE_KEY
  if (!clientEmail || !privateKey) return
  const url = urlFor(slug)
  void (async () => {
    try {
      const token = await googleAccessToken(clientEmail, privateKey)
      const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      })
      if (!res.ok) log.warn({ status: res.status, url }, 'Google Indexing ping failed')
      else log.info({ url }, 'Google Indexing ping sent')
    } catch (err) {
      log.warn({ err, url }, 'Google Indexing ping error')
    }
  })()
}

/**
 * Notify every configured search engine that a forecast URL was created or updated.
 * Fire-and-forget; each provider no-ops when unconfigured. Call this on publish,
 * approve, resolve, admin edit, reject — and on re-slug (English canonicalization),
 * where the URL itself changes and the old slug only 308-redirects.
 */
export function notifySearchEngines(slug: string): void {
  notifyIndexNow(slug)
  notifyGoogle(slug)
}
