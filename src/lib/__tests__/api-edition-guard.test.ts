import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIsSelfHosted } = vi.hoisted(() => ({ mockIsSelfHosted: vi.fn() }))

vi.mock('@/lib/edition', () => ({ isSelfHosted: mockIsSelfHosted }))

import { blockedOnSelfHost } from '@/lib/api-edition-guard'

describe('blockedOnSelfHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a 404 response on the self-hosted edition', async () => {
    mockIsSelfHosted.mockReturnValue(true)

    const res = blockedOnSelfHost()

    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
    const body = await res!.json()
    expect(body).toEqual({ error: 'Not found' })
  })

  it('returns null on the SaaS edition, letting the handler run', () => {
    mockIsSelfHosted.mockReturnValue(false)

    const res = blockedOnSelfHost()

    expect(res).toBeNull()
  })
})
