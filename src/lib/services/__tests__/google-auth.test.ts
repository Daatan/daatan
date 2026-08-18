import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('jose', () => ({
  importPKCS8: vi.fn(async () => ({ type: 'private' })),
  SignJWT: class {
    private payload: Record<string, unknown>
    constructor(payload: Record<string, unknown>) {
      this.payload = payload
    }
    setProtectedHeader() { return this }
    setIssuer(v: string) { this.payload.iss = v; return this }
    setSubject(v: string) { this.payload.sub = v; return this }
    setAudience(v: string) { this.payload.aud = v; return this }
    setIssuedAt() { return this }
    setExpirationTime() { return this }
    async sign() { return `signed:${JSON.stringify(this.payload)}` }
  },
}))

import { importPKCS8 } from 'jose'
import { googleAccessToken, clearGoogleTokenCache } from '@/lib/services/google-auth'

const EMAIL = 'sa@daatan.iam.gserviceaccount.com'
const KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  clearGoogleTokenCache()
  vi.useFakeTimers()
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ access_token: 'ya29.first', expires_in: 3600 }),
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('googleAccessToken', () => {
  it('exchanges a signed assertion for an access token', async () => {
    const token = await googleAccessToken(EMAIL, KEY, SCOPE)
    expect(token).toBe('ya29.first')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(body.get('assertion')).toContain(`"scope":"${SCOPE}"`)
    expect(body.get('assertion')).toContain(`"iss":"${EMAIL}"`)
  })

  it('un-escapes newlines that env transport turned into literal backslash-n', async () => {
    await googleAccessToken(EMAIL, KEY, SCOPE)
    expect(vi.mocked(importPKCS8).mock.calls[0][0]).toBe(
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    )
  })

  it('reuses a cached token instead of re-signing on every call', async () => {
    await googleAccessToken(EMAIL, KEY, SCOPE)
    await googleAccessToken(EMAIL, KEY, SCOPE)
    await googleAccessToken(EMAIL, KEY, SCOPE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps scopes separate — tokens for different scopes are not interchangeable', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'cloud', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'indexing', expires_in: 3600 }) })

    expect(await googleAccessToken(EMAIL, KEY, SCOPE)).toBe('cloud')
    expect(await googleAccessToken(EMAIL, KEY, 'https://www.googleapis.com/auth/indexing')).toBe('indexing')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('re-mints once the server-reported lifetime runs out', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'first', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'second', expires_in: 3600 }) })

    expect(await googleAccessToken(EMAIL, KEY, SCOPE)).toBe('first')
    // 3600s minus the 5-minute renewal skew — still inside the window.
    vi.advanceTimersByTime(54 * 60 * 1000)
    expect(await googleAccessToken(EMAIL, KEY, SCOPE)).toBe('first')
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(await googleAccessToken(EMAIL, KEY, SCOPE)).toBe('second')
  })

  it('does not cache a token whose usable window has already closed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'shortlived', expires_in: 60 }) })
    await googleAccessToken(EMAIL, KEY, SCOPE)
    await googleAccessToken(EMAIL, KEY, SCOPE)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on a rejected exchange rather than returning an empty token', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await expect(googleAccessToken(EMAIL, KEY, SCOPE)).rejects.toThrow('token endpoint 401')
  })

  it('throws when the exchange succeeds but carries no token', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(googleAccessToken(EMAIL, KEY, SCOPE)).rejects.toThrow('no access_token')
  })
})
