import { describe, it, expect, vi, beforeEach } from 'vitest'

// The config under test is whatever function is handed to next-intl's getRequestConfig;
// make that an identity so the module's default export is the resolver itself.
vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}))

const cookieValue = vi.fn<() => string | undefined>()
const acceptLanguage = vi.fn<() => string | null>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'NEXT_LOCALE' && cookieValue() ? { value: cookieValue() } : undefined) }),
  headers: async () => ({ get: (name: string) => (name === 'accept-language' ? acceptLanguage() : null) }),
}))

import resolve from '../request'

type Resolver = (params: { requestLocale: Promise<string | undefined> }) => Promise<{ locale: string; messages: Record<string, unknown> }>
const config = resolve as unknown as Resolver

describe('i18n request config', () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(undefined)
    acceptLanguage.mockReset().mockReturnValue(null)
  })

  it('serves the locale a /he page asks for, even when the cookie and browser say otherwise', async () => {
    // The bug: /he/terms, /he/privacy and /he/accessibility rendered English body text for
    // every visitor without a Hebrew browser, because the explicit page locale was ignored.
    cookieValue.mockReturnValue('ru')
    acceptLanguage.mockReturnValue('en-US,en;q=0.9')
    const result = await config({ requestLocale: Promise.resolve('he') })
    expect(result.locale).toBe('he')
    expect((result.messages.accessibility as Record<string, string>).title).toBe('הצהרת נגישות')
  })

  it('falls back to the cookie when no page locale is given', async () => {
    cookieValue.mockReturnValue('ru')
    acceptLanguage.mockReturnValue('he')
    const result = await config({ requestLocale: Promise.resolve(undefined) })
    expect(result.locale).toBe('ru')
  })

  it('negotiates from Accept-Language when there is neither a page locale nor a cookie', async () => {
    acceptLanguage.mockReturnValue('he-IL,he;q=0.9,en;q=0.5')
    const result = await config({ requestLocale: Promise.resolve(undefined) })
    expect(result.locale).toBe('he')
  })

  it('defaults to English with nothing to go on, and ignores an unsupported page locale', async () => {
    expect((await config({ requestLocale: Promise.resolve(undefined) })).locale).toBe('en')
    expect((await config({ requestLocale: Promise.resolve('xx') })).locale).toBe('en')
  })
})
