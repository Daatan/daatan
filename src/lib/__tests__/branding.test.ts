import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIsSelfHosted, mockGetCachedSetting, mockEnv } = vi.hoisted(() => ({
  mockIsSelfHosted: vi.fn(),
  mockGetCachedSetting: vi.fn(),
  mockEnv: {} as Record<string, string | undefined>,
}))

vi.mock('@/lib/edition', () => ({ isSelfHosted: mockIsSelfHosted }))
vi.mock('@/lib/services/settings', () => ({
  getCachedSetting: mockGetCachedSetting,
  SETTING_KEYS: { appName: 'app_name', appLogoUrl: 'app_logo_url' },
}))
vi.mock('@/env', () => ({ env: mockEnv }))

import { getNoreplyEmail, getContactEmail } from '@/lib/branding'

describe('getNoreplyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
    mockGetCachedSetting.mockReturnValue(null)
  })

  it('returns the Daatan literal on the SaaS edition regardless of env', () => {
    mockIsSelfHosted.mockReturnValue(false)
    mockEnv.EMAIL_FROM = 'Someone <else@example.com>'

    expect(getNoreplyEmail()).toBe('Daatan <noreply@daatan.com>')
  })

  it('uses EMAIL_FROM when set on self-host', () => {
    mockIsSelfHosted.mockReturnValue(true)
    mockEnv.APP_URL = 'https://forecasts.example.com'
    mockEnv.EMAIL_FROM = 'Example <noreply@example.com>'

    expect(getNoreplyEmail()).toBe('Example <noreply@example.com>')
  })

  it('derives a default from APP_URL when EMAIL_FROM is unset on self-host', () => {
    mockIsSelfHosted.mockReturnValue(true)
    mockEnv.APP_URL = 'https://forecasts.example.com'

    expect(getNoreplyEmail()).toBe('noreply@forecasts.example.com')
  })
})

describe('getContactEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
    mockGetCachedSetting.mockReturnValue(null)
  })

  it('returns the Daatan literal on the SaaS edition regardless of env', () => {
    mockIsSelfHosted.mockReturnValue(false)
    mockEnv.CONTACT_EMAIL = 'else@example.com'

    expect(getContactEmail()).toBe('office@daatan.com')
  })

  it('uses CONTACT_EMAIL when set on self-host', () => {
    mockIsSelfHosted.mockReturnValue(true)
    mockEnv.APP_URL = 'https://forecasts.example.com'
    mockEnv.CONTACT_EMAIL = 'contact@example.com'

    expect(getContactEmail()).toBe('contact@example.com')
  })

  it('derives a default from APP_URL when CONTACT_EMAIL is unset on self-host', () => {
    mockIsSelfHosted.mockReturnValue(true)
    mockEnv.APP_URL = 'https://forecasts.example.com'

    expect(getContactEmail()).toBe('office@forecasts.example.com')
  })
})
