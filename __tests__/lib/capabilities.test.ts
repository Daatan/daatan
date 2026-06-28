import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Capability gating: AI / external-market add-ons are always on for SaaS, and
 * off by default for self_hosted unless explicitly enabled. An unset edition
 * (the SKIP_ENV_VALIDATION test/default case) must behave like SaaS — on — so
 * existing tests and prod are unchanged.
 */

const mockEnv: Record<string, unknown> = {}
vi.mock('@/env', () => ({ env: mockEnv }))

async function load() {
  vi.resetModules()
  return import('@/lib/capabilities')
}

describe('capabilities', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
  })

  it('treats SaaS (and unset edition) as fully enabled', async () => {
    const c = await load()
    // edition unset
    expect(c.aiFeaturesEnabled()).toBe(true)
    expect(c.externalMarketsEnabled()).toBe(true)
    mockEnv.DAATAN_EDITION = 'saas'
    const c2 = await load()
    expect(c2.aiFeaturesEnabled()).toBe(true)
    expect(c2.externalMarketsEnabled()).toBe(true)
  })

  it('defaults self_hosted add-ons OFF', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const c = await load()
    expect(c.aiFeaturesEnabled()).toBe(false)
    expect(c.externalMarketsEnabled()).toBe(false)
    expect(c.getCapabilities()).toEqual({ ai: false, externalMarkets: false })
  })

  it('enables each self_hosted add-on only on explicit true', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.ENABLE_AI_FEATURES = 'true'
    mockEnv.ENABLE_EXTERNAL_MARKETS = 'false'
    const c = await load()
    expect(c.aiFeaturesEnabled()).toBe(true)
    expect(c.externalMarketsEnabled()).toBe(false)
    expect(c.getCapabilities()).toEqual({ ai: true, externalMarkets: false })
  })
})
