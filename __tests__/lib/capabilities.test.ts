import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Capability gating. SaaS (and unset edition, the SKIP_ENV_VALIDATION case) is
 * always fully on. For self_hosted: AI turns on when an LLM key is configured
 * (the key is the opt-in) or via the explicit ENABLE_AI_FEATURES override;
 * "AI research" (Analyze) additionally needs a search backend (the Oracle).
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
    expect(c.aiFeaturesEnabled()).toBe(true)
    expect(c.aiResearchEnabled()).toBe(true)
    expect(c.externalMarketsEnabled()).toBe(true)
    mockEnv.DAATAN_EDITION = 'saas'
    const c2 = await load()
    expect(c2.aiFeaturesEnabled()).toBe(true)
  })

  it('defaults self_hosted add-ons OFF with no keys', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const c = await load()
    expect(c.aiFeaturesEnabled()).toBe(false)
    expect(c.aiResearchEnabled()).toBe(false)
    expect(c.externalMarketsEnabled()).toBe(false)
    expect(c.getCapabilities()).toEqual({ ai: false, aiResearch: false, externalMarkets: false })
  })

  it('turns AI on when an LLM key is configured (the key is the opt-in)', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.OPENROUTER_API_KEY = 'or-key'
    const c = await load()
    expect(c.aiFeaturesEnabled()).toBe(true)
    // ...but Analyze stays off until a search backend exists.
    expect(c.aiResearchEnabled()).toBe(false)
  })

  it('Gemini or Ollama also enable AI', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.GEMINI_API_KEY = 'g'
    expect((await load()).aiFeaturesEnabled()).toBe(true)
    delete mockEnv.GEMINI_API_KEY
    mockEnv.OLLAMA_BASE_URL = 'http://ollama:11434'
    expect((await load()).aiFeaturesEnabled()).toBe(true)
  })

  it('AI research turns on only with LLM + search (Oracle) configured', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.OPENROUTER_API_KEY = 'or-key'
    mockEnv.ORACLE_URL = 'https://oracle'
    mockEnv.ORACLE_API_KEY = 'k'
    expect((await load()).aiResearchEnabled()).toBe(true)
  })

  it('ENABLE_AI_FEATURES is an explicit override; markets gate stays separate', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    mockEnv.ENABLE_AI_FEATURES = 'true'
    mockEnv.ENABLE_EXTERNAL_MARKETS = 'false'
    const c = await load()
    expect(c.aiFeaturesEnabled()).toBe(true)
    expect(c.externalMarketsEnabled()).toBe(false)
  })
})
