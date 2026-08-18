import { SignJWT, importPKCS8 } from 'jose'

/**
 * Service-account → OAuth2 access token, for any Google API this app calls with
 * SA credentials rather than an API key.
 *
 * Lifted verbatim out of `indexnow.ts`, which has been doing this for the Indexing
 * API since long before Vertex needed it — the only thing that was ever
 * Indexing-specific was the hardcoded scope. Nothing new is introduced here: no
 * SDK, no google-auth-library, just `jose` (already a dependency) and the two
 * fetches the exchange actually requires.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** Renew this long before real expiry, so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000

interface CachedToken {
  token: string
  expiresAt: number
}

/**
 * Keyed by (client email, scope) — the same SA legitimately holds tokens for
 * different scopes, and they are not interchangeable.
 *
 * Caching is not an optimisation here, it is a correctness requirement: an
 * uncached exchange would add two network round-trips and an RSA signature to
 * *every* LLM call, on a path that already has a 30s budget and a fallback chain
 * behind it. Tokens are valid for an hour; in-memory is the right lifetime, since
 * a restart simply re-mints one.
 */
const tokenCache = new Map<string, CachedToken>()

export async function googleAccessToken(
  clientEmail: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const cacheKey = `${clientEmail}\0${scope}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  // SA keys are PKCS8 PEM; env transport often escapes newlines as literal "\n".
  const key = await importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`token endpoint ${res.status}`)
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('token endpoint returned no access_token')

  // Trust the server's lifetime rather than assuming 3600s — and never cache a
  // token whose usable window has already closed once the skew is applied.
  const lifetimeMs = (json.expires_in ?? 3600) * 1000
  if (lifetimeMs > EXPIRY_SKEW_MS) {
    tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + lifetimeMs - EXPIRY_SKEW_MS })
  }
  return json.access_token
}

/** Test seam: the cache is process-wide, so it has to be resettable between cases. */
export function clearGoogleTokenCache(): void {
  tokenCache.clear()
}
